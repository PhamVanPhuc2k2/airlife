-- Truy vấn cho trang quản trị. Danh sách dùng phân trang offset (trang quản trị cần "tổng số" và
-- nhảy trang; khác danh sách công khai dùng con trỏ).

-- name: AdminRole :one
SELECT role, status FROM users WHERE id = $1;

-- name: InsertAudit :exec
INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
VALUES ($1, $2, $3, $4, $5);

-- name: ListAudit :many
SELECT a.id, a.action, a.target_type, a.target_id, a.detail, a.created_at, COALESCE(u.display_name, '') AS actor_name
FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
ORDER BY a.id DESC LIMIT $1;

-- Số liệu tổng quan: một truy vấn, mỗi cột một con số.
-- name: AdminStats :one
SELECT
  (SELECT count(*) FROM users)::bigint AS users_total,
  (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::bigint AS users_week,
  (SELECT count(*) FROM orders)::bigint AS orders_total,
  (SELECT count(*) FROM orders WHERE status = 'pending')::bigint AS orders_pending,
  (SELECT COALESCE(sum(total), 0) FROM orders WHERE status = 'completed')::bigint AS orders_revenue,
  (SELECT count(*) FROM bookings WHERE status = 'confirmed')::bigint AS bookings_confirmed,
  (SELECT COALESCE(sum(amount), 0) FROM payments WHERE status = 'succeeded')::bigint AS payments_revenue,
  (SELECT count(*) FROM payments WHERE refund_required)::bigint AS refunds_pending,
  (SELECT count(*) FROM feedbacks WHERE status = 'new')::bigint AS feedbacks_new,
  (SELECT count(*) FROM comments WHERE status = 'hidden')::bigint AS comments_hidden,
  (SELECT COALESCE(sum(view_count), 0) FROM media)::bigint AS media_views;

-- ---- Kiểm duyệt ----

-- name: AdminListComments :many
SELECT cm.id, cm.body, cm.status, cm.like_count, cm.created_at, u.display_name AS author,
       COALESCE(m.title, n.title, '') AS target, count(*) OVER ()::bigint AS total
FROM comments cm
JOIN users u ON u.id = cm.user_id
LEFT JOIN media m ON m.id = cm.media_id
LEFT JOIN news n ON n.id = cm.news_id
WHERE (sqlc.arg('status')::text = '' OR cm.status = sqlc.arg('status'))
  AND (sqlc.arg('q')::text = '' OR cm.body ILIKE '%' || sqlc.arg('q') || '%')
ORDER BY cm.created_at DESC, cm.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminGetComment :one
SELECT id, parent_id, status FROM comments WHERE id = $1 FOR UPDATE;

-- name: AdminSetCommentStatus :exec
UPDATE comments SET status = $2, updated_at = now() WHERE id = $1;

-- name: AdminListExperiences :many
SELECT e.id, e.route, e.rating, e.body, e.status, e.like_count, e.created_at, u.display_name AS author,
       count(*) OVER ()::bigint AS total
FROM experiences e JOIN users u ON u.id = e.user_id
WHERE (sqlc.arg('status')::text = '' OR e.status = sqlc.arg('status'))
  AND (sqlc.arg('q')::text = '' OR e.body ILIKE '%' || sqlc.arg('q') || '%')
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminSetExperienceStatus :execrows
UPDATE experiences SET status = $2 WHERE id = $1;

-- name: AdminListFeedbacks :many
SELECT f.id, f.topic, f.rating, f.body, f.flight_code, f.email, f.status, f.created_at,
       COALESCE(u.display_name, '') AS author, count(*) OVER ()::bigint AS total
FROM feedbacks f LEFT JOIN users u ON u.id = f.user_id
WHERE (sqlc.arg('status')::text = '' OR f.status = sqlc.arg('status'))
ORDER BY f.created_at DESC, f.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminSetFeedbackStatus :execrows
UPDATE feedbacks SET status = $2 WHERE id = $1;

-- ---- Khảo sát ----

-- name: AdminListSurveys :many
SELECT s.id, s.question, s.status, s.position, s.created_at,
       (SELECT count(*) FROM survey_votes v WHERE v.survey_id = s.id)::bigint AS votes,
       (SELECT count(*) FROM survey_options o WHERE o.survey_id = s.id)::bigint AS options
FROM surveys s ORDER BY s.position, s.created_at DESC;

-- name: AdminCreateSurvey :one
INSERT INTO surveys (question, position)
VALUES ($1, COALESCE((SELECT max(position) + 1 FROM surveys), 0))
RETURNING id;

-- name: AdminCreateSurveyOption :exec
INSERT INTO survey_options (survey_id, label, position) VALUES ($1, $2, $3);

-- name: AdminUpdateSurvey :execrows
UPDATE surveys SET question = $2, status = $3 WHERE id = $1;

-- name: AdminDeleteSurvey :execrows
DELETE FROM surveys WHERE id = $1;

-- ---- Đơn hàng ----

-- name: AdminListOrders :many
SELECT o.id, o.code, o.status, o.delivery_method, o.recipient_name, o.phone, o.total, o.created_at,
       count(*) OVER ()::bigint AS total_rows
FROM orders o
WHERE (sqlc.arg('status')::text = '' OR o.status = sqlc.arg('status'))
  AND (sqlc.arg('q')::text = '' OR o.code ILIKE '%' || sqlc.arg('q') || '%' OR o.phone LIKE '%' || sqlc.arg('q') || '%')
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminGetOrder :one
SELECT o.id, o.code, o.status, o.delivery_method, o.recipient_name, o.phone, o.flight_code, o.flight_date,
       o.address, o.note, o.subtotal, o.shipping_fee, o.total, o.created_at, u.email, u.display_name
FROM orders o JOIN users u ON u.id = o.user_id WHERE o.code = $1;

-- Chuyển trạng thái: điều kiện trạng thái hiện tại nằm trong WHERE. Hai nhân viên cùng bấm thì
-- chỉ một người đổi được (người kia nhận 0 dòng và thấy "đơn đã đổi trạng thái").
-- name: AdminTransitionOrder :one
UPDATE orders SET status = sqlc.arg('to_status'),
    cancelled_at = CASE WHEN sqlc.arg('to_status')::text = 'cancelled' THEN now() ELSE cancelled_at END,
    updated_at = now()
WHERE code = sqlc.arg('code') AND status = sqlc.arg('from_status')
RETURNING id;

-- ---- Hoàn tiền ----

-- name: AdminListRefunds :many
SELECT p.id, p.code, p.amount, p.provider, p.failure_reason, p.refund_required, p.refunded_at, p.refund_note,
       p.paid_at, p.created_at, b.code AS booking_code, b.product_name, b.status AS booking_status,
       u.email, u.display_name, count(*) OVER ()::bigint AS total
FROM payments p
JOIN bookings b ON b.id = p.booking_id
JOIN users u ON u.id = p.user_id
WHERE CASE sqlc.arg('filter')::text
        WHEN 'done' THEN p.refunded_at IS NOT NULL
        ELSE p.refund_required END
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminMarkRefunded :one
UPDATE payments SET refund_required = false, refunded_at = now(), refunded_by = sqlc.arg('by'),
    refund_note = sqlc.arg('note'), updated_at = now()
WHERE code = sqlc.arg('code') AND refund_required
RETURNING id;

-- ---- Người dùng ----

-- name: AdminListUsers :many
SELECT id, email, display_name, role, status, email_verified_at, created_at, last_login_at,
       count(*) OVER ()::bigint AS total
FROM users
WHERE (sqlc.arg('role')::text = '' OR role = sqlc.arg('role'))
  AND (sqlc.arg('q')::text = '' OR email ILIKE '%' || sqlc.arg('q') || '%' OR display_name ILIKE '%' || sqlc.arg('q') || '%')
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: AdminUpdateUser :one
UPDATE users SET role = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING id;

-- name: AdminGetUser :one
SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE;
