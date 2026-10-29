-- name: GetChannelBySlug :one
SELECT c.id, c.slug, c.name, c.type, c.verified, c.followers_count, c.description, c.avatar_url,
       (SELECT count(*) FROM media m WHERE m.channel_id = c.id AND m.status = 'published') AS media_count
FROM channels c
WHERE c.slug = $1;

-- name: IsFollowing :one
SELECT EXISTS (SELECT 1 FROM channel_followers WHERE channel_id = $1 AND user_id = $2);

-- :execrows trả số dòng bị ảnh hưởng: 1 = vừa theo dõi, 0 = đã theo dõi từ trước (ON CONFLICT).
-- Nhờ vậy bấm "Theo dõi" hai lần không cộng followers_count hai lần.
-- name: FollowChannel :execrows
INSERT INTO channel_followers (channel_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnfollowChannel :execrows
DELETE FROM channel_followers WHERE channel_id = $1 AND user_id = $2;

-- name: AddChannelFollowers :one
UPDATE channels SET followers_count = followers_count + sqlc.arg('delta')::bigint
WHERE id = sqlc.arg('id')
RETURNING followers_count;

-- Kênh người dùng đang theo dõi (menu dọc), theo dõi gần nhất trước.
-- name: ListFollowing :many
SELECT c.slug, c.name, c.verified
FROM channel_followers cf
JOIN channels c ON c.id = cf.channel_id
WHERE cf.user_id = $1
ORDER BY cf.created_at DESC
LIMIT 50;
