-- name: ListNewsCategories :many
SELECT slug, name, description
FROM news_categories
ORDER BY sort_order;

-- Danh sách bài viết (không lấy body_html: nặng, danh sách không cần).
-- name: ListNews :many
SELECT n.id, n.slug, n.category_slug, nc.name AS category_name, n.title, n.excerpt,
       n.cover_url, n.author, n.published_at
FROM news n
JOIN news_categories nc ON nc.slug = n.category_slug
WHERE n.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR n.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (n.published_at, n.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY n.published_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: GetNewsBySlug :one
SELECT n.id, n.slug, n.category_slug, nc.name AS category_name, n.title, n.excerpt,
       n.body_html, n.cover_url, n.author, n.published_at, n.updated_at
FROM news n
JOIN news_categories nc ON nc.slug = n.category_slug
WHERE n.slug = $1 AND n.status = 'published';

-- Đọc thêm: ưu tiên cùng chuyên mục, rồi mới nhất.
-- name: ListRelatedNews :many
SELECT n.id, n.slug, n.category_slug, nc.name AS category_name, n.title, n.excerpt,
       n.cover_url, n.author, n.published_at
FROM news n
JOIN news_categories nc ON nc.slug = n.category_slug
WHERE n.status = 'published' AND n.id <> sqlc.arg('exclude_id')
ORDER BY (n.category_slug = sqlc.arg('category')) DESC, n.published_at DESC
LIMIT sqlc.arg('limit');
