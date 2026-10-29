-- Giỏ hàng (Phần 07).

-- Dòng giỏ của người đã đăng nhập, kèm thông tin để hiện và kiểm tra (còn bán không, còn hàng
-- không, cách nhận hàng). Sản phẩm bị ẩn hay biến thể ngừng bán VẪN trả về (available = false)
-- để khách thấy và bỏ khỏi giỏ, thay vì món hàng tự biến mất không rõ lý do.
-- name: ListCartLines :many
SELECT v.id AS variant_id, v.label, v.price, v.old_price, v.stock,
       (v.active AND p.status = 'published' AND p.kind = 'goods')::boolean AS available,
       p.slug, p.name, p.image_url, p.delivery_methods,
       c.name AS channel_name, ci.quantity
FROM cart_items ci
JOIN product_variants v ON v.id = ci.variant_id
JOIN products p ON p.id = v.product_id
JOIN channels c ON c.id = p.channel_id
WHERE ci.user_id = $1
ORDER BY ci.updated_at DESC, v.id;

-- Giỏ của khách chưa đăng nhập nằm trong trình duyệt (chỉ có id biến thể và số lượng); API trả
-- thông tin hiện tại của các biến thể đó. Giá luôn lấy từ server, không tin giá client gửi.
-- name: GetVariantsForCart :many
SELECT v.id AS variant_id, v.label, v.price, v.old_price, v.stock,
       (v.active AND p.status = 'published' AND p.kind = 'goods')::boolean AS available,
       p.slug, p.name, p.image_url, p.delivery_methods,
       c.name AS channel_name
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN channels c ON c.id = p.channel_id
WHERE v.id = ANY(sqlc.arg('ids')::uuid[]);

-- Đặt số lượng một dòng giỏ. Chỉ thêm được biến thể đang bán của hàng hoá (vé, tour đi đường
-- đặt chỗ ở Phần 08). 0 dòng = biến thể không tồn tại / không bán.
-- name: SetCartItem :execrows
INSERT INTO cart_items (user_id, variant_id, quantity)
SELECT sqlc.arg('user_id'), v.id, sqlc.arg('quantity')
FROM product_variants v JOIN products p ON p.id = v.product_id
WHERE v.id = sqlc.arg('variant_id') AND v.active AND p.status = 'published' AND p.kind = 'goods'
ON CONFLICT (user_id, variant_id) DO UPDATE
SET quantity = EXCLUDED.quantity, updated_at = now();

-- Gộp giỏ của khách vào giỏ trên server khi đăng nhập: lấy số LỚN HƠN, không cộng dồn. Gộp hai
-- lần (bấm đăng nhập ở hai tab, mạng gửi lại) vẫn ra cùng kết quả; cộng dồn thì số lượng nhân đôi.
-- name: MergeCartItem :exec
INSERT INTO cart_items (user_id, variant_id, quantity)
SELECT sqlc.arg('user_id'), v.id, sqlc.arg('quantity')
FROM product_variants v JOIN products p ON p.id = v.product_id
WHERE v.id = sqlc.arg('variant_id') AND v.active AND p.status = 'published' AND p.kind = 'goods'
ON CONFLICT (user_id, variant_id) DO UPDATE
SET quantity = GREATEST(cart_items.quantity, EXCLUDED.quantity), updated_at = now();

-- name: DeleteCartItem :exec
DELETE FROM cart_items WHERE user_id = $1 AND variant_id = $2;

-- name: ClearCart :exec
DELETE FROM cart_items WHERE user_id = $1;

-- name: CountCartLines :one
SELECT count(*) FROM cart_items WHERE user_id = $1;
