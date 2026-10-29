-- Đặt vé, tour (Phần 08).

-- Hạng dịch vụ của một sản phẩm
-- name: ListProductFares :many
SELECT f.id, f.code, f.label, f.description, f.adult_price, f.child_price
FROM product_fares f
JOIN products p ON p.id = f.product_id
WHERE p.slug = $1 AND p.status = 'published' AND p.kind = 'booking'
ORDER BY f.sort_order;

-- Lịch khởi hành còn mở, từ ngày from_date (ngày mai: chốt đặt trước một ngày) trong 120 ngày tới,
-- mỗi dòng là một (ngày, hạng) kèm số chỗ còn lại
-- name: ListDepartureSeats :many
SELECT d.id AS departure_id, d.depart_date, d.return_date, s.fare_id, s.capacity - s.taken AS seats_left
FROM departures d
JOIN products p ON p.id = d.product_id
JOIN departure_seats s ON s.departure_id = d.id
JOIN product_fares f ON f.id = s.fare_id
WHERE p.slug = sqlc.arg('slug') AND d.status = 'open'
  AND d.depart_date >= sqlc.arg('from_date')::date
  AND d.depart_date < sqlc.arg('from_date')::date + 120
ORDER BY d.depart_date, f.sort_order;

-- Thông tin để tạo đơn: ngày khởi hành + hạng phải cùng một sản phẩm đang bán
-- name: GetDepartureFare :one
SELECT d.id AS departure_id, d.depart_date, d.return_date, d.status AS departure_status,
       f.id AS fare_id, f.label AS fare_label, f.adult_price, f.child_price,
       p.slug AS product_slug, p.name AS product_name, p.tag
FROM departures d
JOIN products p ON p.id = d.product_id
JOIN product_fares f ON f.product_id = p.id
WHERE d.id = sqlc.arg('departure_id') AND f.id = sqlc.arg('fare_id')
  AND p.status = 'published' AND p.kind = 'booking';

-- Lấy chỗ CÓ ĐIỀU KIỆN (như trừ kho ở Phần 07): còn đủ chỗ thì lấy, không thì 0 dòng.
-- name: TakeSeats :execrows
UPDATE departure_seats SET taken = taken + sqlc.arg('seats')
WHERE departure_id = sqlc.arg('departure_id') AND fare_id = sqlc.arg('fare_id')
  AND taken + sqlc.arg('seats') <= capacity;

-- name: SeatsLeft :one
SELECT capacity - taken FROM departure_seats WHERE departure_id = $1 AND fare_id = $2;

-- Số đơn đang giữ chỗ của một người (chặn "giữ chỗ hàng loạt" rồi bỏ đó)
-- name: CountActiveHolds :one
SELECT count(*) FROM bookings
WHERE user_id = $1 AND status IN ('held', 'awaiting_payment') AND expires_at > now();

-- name: GetBookingCodeByIdempotencyKey :one
SELECT code FROM bookings WHERE user_id = $1 AND idempotency_key = $2;

-- name: CreateBooking :one
INSERT INTO bookings (code, user_id, departure_id, fare_id, expires_at, adults, children,
                      product_slug, product_name, fare_label, depart_date, return_date,
                      adult_price, child_price, total, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING id;

-- name: GetBooking :one
SELECT b.id, b.code, b.status, b.expires_at, b.adults, b.children, b.product_slug, b.product_name,
       b.fare_label, b.depart_date, b.return_date, b.adult_price, b.child_price, b.total,
       b.contact_name, b.contact_phone, b.contact_email, b.created_at,
       p.tag AS product_tag, p.image_url AS product_image
FROM bookings b
JOIN departures d ON d.id = b.departure_id
JOIN products p ON p.id = d.product_id
WHERE b.user_id = $1 AND b.code = $2;

-- name: ListBookingPassengers :many
SELECT kind, full_name, birth_date FROM booking_passengers WHERE booking_id = $1 ORDER BY position;

-- name: ListBookings :many
SELECT b.code, b.status, b.expires_at, b.product_name, b.fare_label, b.depart_date, b.adults,
       b.children, b.total, b.created_at, b.id, p.image_url AS product_image
FROM bookings b
JOIN departures d ON d.id = b.departure_id
JOIN products p ON p.id = d.product_id
WHERE b.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (b.created_at, b.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY b.created_at DESC, b.id DESC
LIMIT sqlc.arg('limit');

-- Khoá đơn để điền hành khách: chỉ khi còn đang giữ chỗ và chưa hết hạn
-- name: LockBookingForUpdate :one
SELECT id, adults, children, depart_date FROM bookings
WHERE user_id = $1 AND code = $2 AND status IN ('held', 'awaiting_payment') AND expires_at > now()
FOR UPDATE;

-- name: DeleteBookingPassengers :exec
DELETE FROM booking_passengers WHERE booking_id = $1;

-- name: CreateBookingPassenger :exec
INSERT INTO booking_passengers (booking_id, position, kind, full_name, birth_date)
VALUES ($1, $2, $3, $4, $5);

-- name: SetBookingContact :exec
UPDATE bookings
SET contact_name = $2, contact_phone = $3, contact_email = $4, status = 'awaiting_payment',
    updated_at = now()
WHERE id = $1;

-- Huỷ và trả ghế trong MỘT câu lệnh (CTE có UPDATE): chỉ đơn còn đang giữ chỗ mới huỷ được.
-- Huỷ cùng lúc với worker hết hạn: chỉ một trong hai đổi được trạng thái (điều kiện status), nên
-- ghế chỉ được trả một lần.
-- name: CancelBooking :execrows
WITH c AS (
    UPDATE bookings SET status = 'cancelled', updated_at = now()
    WHERE user_id = $1 AND code = $2 AND status IN ('held', 'awaiting_payment')
    RETURNING departure_id, fare_id, adults + children AS seats
)
UPDATE departure_seats s SET taken = s.taken - c.seats
FROM c
WHERE s.departure_id = c.departure_id AND s.fare_id = c.fare_id;

-- Worker: hết hạn mọi đơn quá giờ và trả ghế, một câu lệnh. Nhiều đơn cùng (ngày, hạng) thì cộng
-- dồn trước (GROUP BY): UPDATE ... FROM chỉ áp dụng MỘT dòng nguồn cho mỗi dòng đích.
-- name: ExpireBookings :execrows
WITH e AS (
    UPDATE bookings SET status = 'expired', updated_at = now()
    WHERE status IN ('held', 'awaiting_payment') AND expires_at <= now()
    RETURNING departure_id, fare_id, adults + children AS seats
), sums AS (
    SELECT departure_id, fare_id, sum(seats)::integer AS seats FROM e GROUP BY departure_id, fare_id
)
UPDATE departure_seats s SET taken = s.taken - sums.seats
FROM sums
WHERE s.departure_id = sums.departure_id AND s.fare_id = sums.fare_id;
