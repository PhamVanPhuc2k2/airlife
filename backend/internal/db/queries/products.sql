-- Sản phẩm, yêu thích (Phần 07).
--
-- Các truy vấn danh sách chọn CÙNG một bộ cột theo cùng thứ tự, nên các kiểu ...Row sqlc sinh ra
-- có trường giống hệt nhau: Go cho đổi kiểu trực tiếp (db.ListProductsNewRow(row)), và chỉ cần
-- một hàm chuyển sang thẻ sản phẩm (product.toCard). Không dùng sqlc.embed(p) vì sẽ kéo cả
-- body_html (dài) về cho mỗi thẻ.

-- name: ListProductsNew :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR p.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tag = sqlc.narg('tag'))
  AND (sqlc.narg('channel')::text IS NULL OR c.slug = sqlc.narg('channel'))
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (p.published_at, p.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY p.published_at DESC, p.id DESC
LIMIT sqlc.arg('limit');

-- Bán chạy: con trỏ theo (sold_count, id)
-- name: ListProductsBestseller :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR p.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tag = sqlc.narg('tag'))
  AND (sqlc.narg('channel')::text IS NULL OR c.slug = sqlc.narg('channel'))
  AND (sqlc.narg('cursor_sold')::integer IS NULL
       OR (p.sold_count, p.id) < (sqlc.narg('cursor_sold')::integer, sqlc.narg('cursor_id')::uuid))
ORDER BY p.sold_count DESC, p.id DESC
LIMIT sqlc.arg('limit');

-- Cùng chip lọc trước, rồi cùng chuyên mục ("Có thể bạn cũng thích")
-- name: ListRelatedProducts :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published' AND p.category_slug = sqlc.arg('category') AND p.id <> sqlc.arg('exclude_id')
ORDER BY (p.tag = sqlc.arg('tag')) DESC, p.sold_count DESC
LIMIT sqlc.arg('limit');

-- Sản phẩm trong một video (trang xem)
-- name: ListMediaProducts :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media_products mp
JOIN media m ON m.id = mp.media_id
JOIN products p ON p.id = mp.product_id
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE m.slug = $1 AND p.status = 'published'
ORDER BY mp.sort_order;

-- name: GetProductBySlug :one
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.body_html, p.image_url, p.gallery, p.price, p.old_price, p.delivery_methods,
       p.rating, p.rating_count, p.sold_count, p.published_at,
       cat.name AS category_name,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified,
       c.type AS channel_type, c.followers_count AS channel_followers
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN categories cat ON cat.slug = p.category_slug
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.slug = $1 AND p.status = 'published';

-- name: ListProductVariants :many
SELECT id, label, price, old_price, stock
FROM product_variants
WHERE product_id = $1 AND active
ORDER BY sort_order, label;

-- Video có sản phẩm này ("Xuất hiện trong")
-- name: ListProductMedia :many
SELECT sqlc.embed(m), sqlc.embed(c)
FROM media_products mp
JOIN media m ON m.id = mp.media_id
JOIN channels c ON c.id = m.channel_id
WHERE mp.product_id = $1 AND m.status = 'published'
ORDER BY m.published_at DESC
LIMIT 6;

-- Yêu thích --------------------------------------------------------------------------------

-- name: AddFavorite :execrows
INSERT INTO favorites (user_id, product_id)
SELECT sqlc.arg('user_id'), p.id FROM products p
WHERE p.slug = sqlc.arg('slug') AND p.status = 'published'
ON CONFLICT DO NOTHING;

-- name: RemoveFavorite :exec
DELETE FROM favorites f
USING products p
WHERE f.product_id = p.id AND f.user_id = $1 AND p.slug = $2;

-- name: IsFavorite :one
SELECT EXISTS (
    SELECT 1 FROM favorites f JOIN products p ON p.id = f.product_id
    WHERE f.user_id = $1 AND p.slug = $2
);

-- name: GetProductIDBySlug :one
SELECT id FROM products WHERE slug = $1 AND status = 'published';

-- name: ListFavorites :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified,
       f.created_at AS favorited_at
FROM favorites f
JOIN products p ON p.id = f.product_id
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE f.user_id = sqlc.arg('user_id') AND p.status = 'published'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (f.created_at, f.product_id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY f.created_at DESC, f.product_id DESC
LIMIT sqlc.arg('limit');
