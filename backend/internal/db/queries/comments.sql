-- Bình luận gốc (parent_id IS NULL) của một media HOẶC một bài viết.
-- Sắp "Hay": nhiều lượt thích trước, con trỏ (like_count, id).
-- name: ListCommentsTop :many
SELECT cm.id, cm.user_id, u.display_name, u.avatar_url, cm.body, cm.like_count, cm.reply_count, cm.created_at
FROM comments cm
JOIN users u ON u.id = cm.user_id
WHERE cm.parent_id IS NULL AND cm.status = 'visible'
  AND (sqlc.narg('media_id')::uuid IS NULL OR cm.media_id = sqlc.narg('media_id'))
  AND (sqlc.narg('news_id')::uuid IS NULL OR cm.news_id = sqlc.narg('news_id'))
  AND (sqlc.narg('cursor_likes')::int IS NULL
       OR (cm.like_count, cm.id) < (sqlc.narg('cursor_likes')::int, sqlc.narg('cursor_id')::uuid))
ORDER BY cm.like_count DESC, cm.id DESC
LIMIT sqlc.arg('limit');

-- Sắp "Mới": mới nhất trước, con trỏ (created_at, id).
-- name: ListCommentsNew :many
SELECT cm.id, cm.user_id, u.display_name, u.avatar_url, cm.body, cm.like_count, cm.reply_count, cm.created_at
FROM comments cm
JOIN users u ON u.id = cm.user_id
WHERE cm.parent_id IS NULL AND cm.status = 'visible'
  AND (sqlc.narg('media_id')::uuid IS NULL OR cm.media_id = sqlc.narg('media_id'))
  AND (sqlc.narg('news_id')::uuid IS NULL OR cm.news_id = sqlc.narg('news_id'))
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (cm.created_at, cm.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY cm.created_at DESC, cm.id DESC
LIMIT sqlc.arg('limit');

-- Trả lời của một bình luận: cũ trước (đọc như hội thoại), con trỏ (created_at, id) tăng dần.
-- name: ListReplies :many
SELECT cm.id, cm.user_id, u.display_name, u.avatar_url, cm.body, cm.like_count, cm.reply_count, cm.created_at
FROM comments cm
JOIN users u ON u.id = cm.user_id
WHERE cm.parent_id = sqlc.arg('parent_id') AND cm.status = 'visible'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (cm.created_at, cm.id) > (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY cm.created_at, cm.id
LIMIT sqlc.arg('limit');

-- name: GetComment :one
SELECT id, media_id, news_id, parent_id, user_id, status
FROM comments
WHERE id = $1;

-- name: CreateComment :one
INSERT INTO comments (media_id, news_id, parent_id, user_id, body)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at;

-- name: AddReplyCount :exec
UPDATE comments SET reply_count = reply_count + sqlc.arg('delta')::int WHERE id = sqlc.arg('id');

-- name: SoftDeleteComment :exec
UPDATE comments SET status = 'deleted', updated_at = now() WHERE id = $1;

-- name: LikeComment :execrows
INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnlikeComment :execrows
DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2;

-- name: AddCommentLikes :one
UPDATE comments SET like_count = like_count + sqlc.arg('delta')::int
WHERE id = sqlc.arg('id')
RETURNING like_count;

-- Trong các bình luận đang hiện, những cái người dùng đã thích (một truy vấn cho cả trang,
-- không phải mỗi bình luận một truy vấn: tránh lỗi "N+1 truy vấn").
-- name: LikedComments :many
SELECT comment_id FROM comment_likes
WHERE user_id = sqlc.arg('user_id') AND comment_id = ANY(sqlc.arg('ids')::uuid[]);

-- Bình luận nổi bật cho trang chủ: bình luận gốc của media trong 90 ngày, kèm media được bình luận.
-- name: ListHotComments :many
SELECT cm.id, cm.user_id, u.display_name, u.avatar_url, cm.body, cm.like_count, cm.reply_count, cm.created_at,
       m.slug AS media_slug, m.category_slug AS media_category, m.title AS media_title
FROM comments cm
JOIN users u ON u.id = cm.user_id
JOIN media m ON m.id = cm.media_id
WHERE cm.parent_id IS NULL AND cm.status = 'visible' AND m.status = 'published'
  AND cm.created_at > now() - interval '90 days'
ORDER BY CASE WHEN sqlc.arg('by_replies')::bool THEN cm.reply_count ELSE cm.like_count END DESC,
         cm.created_at DESC
LIMIT sqlc.arg('limit');
