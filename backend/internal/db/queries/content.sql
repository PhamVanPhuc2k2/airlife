-- Truy vấn cho chuyên mục, kênh, media. Mỗi khối "-- name: Tên :loại" thành một hàm Go:
--   :one  trả một dòng (không có thì lỗi pgx.ErrNoRows)
--   :many trả slice
--   :exec không trả dữ liệu
-- sqlc.arg('x') / sqlc.narg('x'): tham số tên x; narg = được phép NULL (thành con trỏ trong Go).

-- name: ListCategories :many
SELECT slug, name, icon, title, description
FROM categories
ORDER BY sort_order;

-- name: GetCategory :one
SELECT slug, name, icon, title, description
FROM categories
WHERE slug = $1;

-- name: ListCategoryFilters :many
SELECT slug, name
FROM category_filters
WHERE category_slug = $1
ORDER BY sort_order;

-- Danh sách media mới nhất. Phân trang kiểu con trỏ: trang sau lấy những dòng "nhỏ hơn"
-- (published_at, id) của dòng cuối trang trước. Nhanh hơn OFFSET (không phải đếm bỏ qua
-- hàng nghìn dòng) và không bị trùng/sót khi có media mới chen vào giữa lúc đang cuộn.
-- name: ListMediaNew :many
SELECT m.id, m.slug, m.kind, m.category_slug, m.title, m.group_label, m.genre_label,
       m.youtube_id, m.thumbnail_url, m.duration_seconds, m.episode_count, m.view_count,
       m.featured, m.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media m
JOIN channels c ON c.id = m.channel_id
WHERE m.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR m.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR m.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('lineup_month')::date IS NULL OR m.lineup_month = sqlc.narg('lineup_month'))
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (m.published_at, m.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY m.published_at DESC, m.id DESC
LIMIT sqlc.arg('limit');

-- Danh sách xem nhiều nhất, con trỏ theo (view_count, id).
-- name: ListMediaPopular :many
SELECT m.id, m.slug, m.kind, m.category_slug, m.title, m.group_label, m.genre_label,
       m.youtube_id, m.thumbnail_url, m.duration_seconds, m.episode_count, m.view_count,
       m.featured, m.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media m
JOIN channels c ON c.id = m.channel_id
WHERE m.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR m.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR m.tags @> ARRAY[sqlc.narg('tag')::text])
  AND (sqlc.narg('cursor_views')::bigint IS NULL
       OR (m.view_count, m.id) < (sqlc.narg('cursor_views')::bigint, sqlc.narg('cursor_id')::uuid))
ORDER BY m.view_count DESC, m.id DESC
LIMIT sqlc.arg('limit');

-- name: ListFeaturedMedia :many
SELECT m.id, m.slug, m.kind, m.category_slug, m.title, m.description, m.group_label,
       m.genre_label, m.youtube_id, m.thumbnail_url, m.duration_seconds, m.episode_count,
       m.view_count, m.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media m
JOIN channels c ON c.id = m.channel_id
WHERE m.status = 'published' AND m.featured
ORDER BY m.published_at DESC
LIMIT $1;

-- name: GetMediaBySlug :one
SELECT m.id, m.slug, m.kind, m.category_slug, m.title, m.description, m.group_label,
       m.genre_label, m.tags, m.youtube_id, m.thumbnail_url, m.duration_seconds,
       m.episode_count, m.view_count, m.featured, m.lineup_month, m.published_at,
       cat.name AS category_name,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified,
       c.followers_count AS channel_followers
FROM media m
JOIN channels c ON c.id = m.channel_id
JOIN categories cat ON cat.slug = m.category_slug
WHERE m.slug = $1 AND m.status = 'published';

-- Gợi ý liên quan: cùng chuyên mục, ưu tiên có tag chung (&& = hai mảng có phần tử chung).
-- name: ListRelatedMedia :many
SELECT m.id, m.slug, m.kind, m.category_slug, m.title, m.group_label, m.genre_label,
       m.youtube_id, m.thumbnail_url, m.duration_seconds, m.episode_count, m.view_count,
       m.featured, m.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media m
JOIN channels c ON c.id = m.channel_id
WHERE m.status = 'published'
  AND m.category_slug = sqlc.arg('category')
  AND m.id <> sqlc.arg('exclude_id')
ORDER BY (m.tags && sqlc.arg('tags')::text[]) DESC, m.view_count DESC
LIMIT sqlc.arg('limit');

-- name: GetMediaIDBySlug :one
SELECT id FROM media WHERE slug = $1 AND status = 'published';

-- Cộng lượt xem đã gom trong Redis vào database (worker gọi định kỳ).
-- name: AddMediaViews :exec
UPDATE media SET view_count = view_count + sqlc.arg('views') WHERE id = sqlc.arg('id');
