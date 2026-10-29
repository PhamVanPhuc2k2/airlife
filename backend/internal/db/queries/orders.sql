-- Đơn hàng (Phần 07).

-- name: GetOrderCodeByIdempotencyKey :one
SELECT code FROM orders WHERE user_id = $1 AND idempotency_key = $2;

-- Trừ tồn kho CÓ ĐIỀU KIỆN, trong một câu lệnh: "còn đủ thì trừ". Hai người cùng mua chiếc cuối
-- cùng: câu thứ hai chạy sau câu thứ nhất (PostgreSQL khoá dòng khi UPDATE), thấy stock = 0,
-- không khớp WHERE, trả 0 dòng → báo hết hàng. Không bao giờ bán quá số đang có.
-- name: DecrementStock :execrows
UPDATE product_variants SET stock = stock - sqlc.arg('quantity')
WHERE id = sqlc.arg('id') AND active AND stock >= sqlc.arg('quantity');

-- name: AddProductSold :exec
UPDATE products SET sold_count = GREATEST(sold_count + sqlc.arg('delta')::integer, 0)
WHERE id = (SELECT product_id FROM product_variants WHERE product_variants.id = sqlc.arg('variant_id'));

-- name: CreateOrder :one
INSERT INTO orders (code, user_id, delivery_method, recipient_name, phone, flight_code,
                    flight_date, address, note, subtotal, shipping_fee, total, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id, created_at;

-- name: CreateOrderItem :exec
INSERT INTO order_items (order_id, variant_id, product_slug, product_name, variant_label,
                         image_url, unit_price, quantity, line_total, position)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- Danh sách đơn: kèm ảnh, tên của dòng đầu và số dòng ("Hộp quà Huế và 2 sản phẩm khác")
-- name: ListOrders :many
SELECT o.code, o.status, o.delivery_method, o.total, o.created_at, o.id,
       f.product_name AS first_name, f.image_url AS first_image,
       (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
JOIN order_items f ON f.order_id = o.id AND f.position = 0
WHERE o.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (o.created_at, o.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg('limit');

-- name: GetOrder :one
SELECT id, code, status, payment_method, delivery_method, recipient_name, phone, flight_code,
       flight_date, address, note, subtotal, shipping_fee, total, created_at, cancelled_at
FROM orders WHERE user_id = $1 AND code = $2;

-- name: ListOrderItems :many
SELECT product_slug, product_name, variant_label, image_url, unit_price, quantity, line_total
FROM order_items WHERE order_id = $1 ORDER BY position;

-- Huỷ: chỉ khi còn "chờ xác nhận". Điều kiện status nằm trong WHERE: hai lần bấm huỷ cùng lúc thì
-- chỉ một lần đổi được trạng thái (và chỉ một lần trả hàng về kho).
-- name: CancelOrder :one
UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now()
WHERE user_id = $1 AND code = $2 AND status = 'pending'
RETURNING id;

-- Trả hàng của đơn bị huỷ về kho
-- name: RestockOrder :exec
UPDATE product_variants v SET stock = v.stock + oi.quantity
FROM order_items oi
WHERE oi.order_id = $1 AND oi.variant_id = v.id;

-- name: ListOrderVariantQuantities :many
SELECT variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL;
