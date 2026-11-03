-- Thanh toán online (Phần 09).

-- Khoá đơn đặt chỗ của người dùng trước khi tạo phiên thanh toán: hai request "Thanh toán" cùng
-- lúc phải chờ nhau, không sinh hai phiên song song.
-- name: GetBookingForPayment :one
SELECT id, code, status, expires_at, total, product_name
FROM bookings WHERE user_id = $1 AND code = $2
FOR UPDATE;

-- Phiên cũ của đơn này (khách bấm "Thanh toán" lại): coi như hết hạn
-- name: ExpirePendingPayments :exec
UPDATE payments SET status = 'expired', updated_at = now()
WHERE booking_id = $1 AND status = 'pending';

-- Kéo dài giữ chỗ để khách kịp trả tiền ở trang của cổng (không bao giờ rút ngắn)
-- name: ExtendHold :exec
UPDATE bookings SET expires_at = GREATEST(expires_at, sqlc.arg('until')::timestamptz), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: CreatePayment :one
INSERT INTO payments (code, user_id, booking_id, provider, amount)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- name: SetPaymentTxn :exec
UPDATE payments SET provider_txn = $2, updated_at = now() WHERE id = $1;

-- name: FailPayment :exec
UPDATE payments SET status = 'failed', failure_reason = $2, refund_required = $3, updated_at = now()
WHERE id = $1;

-- Khoá khoản thanh toán khi xử lý sự kiện: webhook và đối soát cùng đến một lúc thì xử lý lần lượt
-- name: GetPaymentForUpdate :one
SELECT id, booking_id, user_id, status, amount, provider
FROM payments WHERE code = $1
FOR UPDATE;

-- Ghi sự kiện đã xử lý. 0 dòng = sự kiện này đã xử lý rồi.
-- name: InsertPaymentEvent :execrows
INSERT INTO payment_events (provider, event_id, payment_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: MarkPaymentSucceeded :exec
UPDATE payments
SET status = 'succeeded', paid_at = now(), provider_txn = COALESCE(sqlc.narg('txn'), provider_txn),
    refund_required = $2, failure_reason = NULL, updated_at = now()
WHERE id = $1;

-- Khoá đơn đặt chỗ theo id khi áp kết quả thanh toán
-- name: GetBookingByIDForUpdate :one
SELECT b.id, b.code, b.status, b.departure_id, b.fare_id, b.adults, b.children, b.product_name,
       b.fare_label, b.depart_date, b.total, b.user_id, b.contact_name, b.contact_email
FROM bookings b WHERE b.id = $1
FOR UPDATE;

-- name: ConfirmBooking :exec
UPDATE bookings SET status = 'confirmed', updated_at = now() WHERE id = $1;

-- Khoản thanh toán đại diện cho đơn (trang đặt chỗ hiện kết quả): khoản đã thành công nếu có,
-- không thì khoản mới nhất. Khách mở phiên mới sau khi đã trả ở phiên cũ thì trang vẫn phải báo
-- "đã thanh toán", không phải "đang chờ" của phiên mới nhất.
-- name: GetLatestPayment :one
SELECT status, refund_required, paid_at FROM payments
WHERE booking_id = $1
ORDER BY (status = 'succeeded') DESC, created_at DESC
LIMIT 1;

-- Đối soát: khoản còn "chờ" quá min_age_seconds giây mà chưa nhận được webhook (mất webhook, server tắt lúc cổng
-- gọi). Quá 24 giờ thì bỏ: phiên của cổng đã hết hạn từ lâu.
-- name: ListPendingPayments :many
SELECT code, provider, provider_txn
FROM payments
WHERE status = 'pending' AND provider_txn IS NOT NULL
  AND created_at < now() - make_interval(secs => sqlc.arg('min_age_seconds')::integer)
  AND created_at > now() - interval '24 hours'
ORDER BY created_at
LIMIT 50;
