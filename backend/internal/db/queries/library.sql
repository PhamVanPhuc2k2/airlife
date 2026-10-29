-- Thư viện cá nhân: lịch sử xem, đã lưu, playlist (Phần 06).
-- sqlc.embed(m): sqlc gom các cột của bảng media thành MỘT trường kiểu db.Medium trong dòng kết quả,
-- nên mọi danh sách ở đây đổi sang media.Card bằng cùng một hàm (media.CardOf).

-- Ghi tiến độ. Chỉ chạy khi media còn đăng: INSERT ... SELECT không ra dòng nào là media không có.
-- name: UpsertWatchProgress :execrows
INSERT INTO watch_history (user_id, media_id, position_seconds, duration_seconds)
SELECT sqlc.arg('user_id'), m.id, sqlc.arg('position'), sqlc.arg('duration')
FROM media m
WHERE m.slug = sqlc.arg('slug') AND m.status = 'published'
ON CONFLICT (user_id, media_id) DO UPDATE
SET position_seconds = EXCLUDED.position_seconds,
    duration_seconds = EXCLUDED.duration_seconds,
    updated_at = now();

-- Đã xem: mới xem nhất trước, con trỏ (updated_at, media_id).
-- name: ListWatchHistory :many
SELECT sqlc.embed(m), sqlc.embed(c), h.position_seconds, h.duration_seconds, h.updated_at
FROM watch_history h
JOIN media m ON m.id = h.media_id
JOIN channels c ON c.id = m.channel_id
WHERE h.user_id = sqlc.arg('user_id') AND m.status = 'published'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (h.updated_at, h.media_id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY h.updated_at DESC, h.media_id DESC
LIMIT sqlc.arg('limit');

-- Tiếp tục xem: xem dở, tức đã qua 30 giây đầu và còn hơn 5% cuối (xem gần hết coi như xong).
-- name: ListContinueWatching :many
SELECT sqlc.embed(m), sqlc.embed(c), h.position_seconds, h.duration_seconds, h.updated_at
FROM watch_history h
JOIN media m ON m.id = h.media_id
JOIN channels c ON c.id = m.channel_id
WHERE h.user_id = $1 AND m.status = 'published'
  AND h.position_seconds >= 30
  AND h.position_seconds < h.duration_seconds * 0.95
ORDER BY h.updated_at DESC
LIMIT $2;

-- name: DeleteWatchHistoryItem :exec
DELETE FROM watch_history h
USING media m
WHERE h.media_id = m.id AND h.user_id = $1 AND m.slug = $2;

-- name: ClearWatchHistory :exec
DELETE FROM watch_history WHERE user_id = $1;

-- name: SaveMedia :execrows
INSERT INTO saved_media (user_id, media_id)
SELECT sqlc.arg('user_id'), m.id FROM media m
WHERE m.slug = sqlc.arg('slug') AND m.status = 'published'
ON CONFLICT DO NOTHING;

-- name: UnsaveMedia :exec
DELETE FROM saved_media s
USING media m
WHERE s.media_id = m.id AND s.user_id = $1 AND m.slug = $2;

-- name: ListSavedMedia :many
SELECT sqlc.embed(m), sqlc.embed(c), s.created_at AS saved_at
FROM saved_media s
JOIN media m ON m.id = s.media_id
JOIN channels c ON c.id = m.channel_id
WHERE s.user_id = sqlc.arg('user_id') AND m.status = 'published'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (s.created_at, s.media_id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY s.created_at DESC, s.media_id DESC
LIMIT sqlc.arg('limit');

-- Trạng thái của MỘT media với người đang xem (trang xem): đã lưu chưa, đang xem tới đâu,
-- nằm trong playlist nào. Một truy vấn thay vì ba.
-- name: GetMediaLibraryState :one
SELECT m.id,
       EXISTS (SELECT 1 FROM saved_media s WHERE s.user_id = sqlc.arg('user_id') AND s.media_id = m.id) AS saved,
       h.position_seconds, h.duration_seconds,
       COALESCE((SELECT array_agg(pi.playlist_id)::uuid[]
                 FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
                 WHERE p.user_id = sqlc.arg('user_id') AND pi.media_id = m.id),
                '{}')::uuid[] AS playlist_ids
FROM media m
LEFT JOIN watch_history h ON h.media_id = m.id AND h.user_id = sqlc.arg('user_id')
WHERE m.slug = sqlc.arg('slug') AND m.status = 'published';

-- Số liệu ở thẻ hồ sơ trang Bạn
-- name: GetLibraryStats :one
SELECT (SELECT count(*) FROM channel_followers cf WHERE cf.user_id = sqlc.arg('user_id')) AS following,
       (SELECT count(*) FROM saved_media s WHERE s.user_id = sqlc.arg('user_id')) AS saved,
       (SELECT count(*) FROM playlists p WHERE p.user_id = sqlc.arg('user_id')) AS playlists,
       (SELECT count(*) FROM watch_history h WHERE h.user_id = sqlc.arg('user_id')) AS watched,
       (SELECT count(*) FROM orders o WHERE o.user_id = sqlc.arg('user_id')) AS orders;

-- Playlist ----------------------------------------------------------------------------------

-- Lưới playlist, kèm ảnh và đường dẫn của mục đầu tiên (nút "Phát tất cả").
-- name: ListPlaylists :many
SELECT p.id, p.name, p.item_count, p.updated_at,
       -- Playlist rỗng thì không có mục đầu: COALESCE ra '' để sqlc sinh kiểu string (không phải NULL)
       COALESCE(f.slug, '')::text AS first_slug, COALESCE(f.category_slug, '')::text AS first_category,
       COALESCE(f.thumbnail_url, '')::text AS first_thumbnail
FROM playlists p
LEFT JOIN LATERAL (
    SELECT m.slug, m.category_slug, m.thumbnail_url
    FROM playlist_items pi JOIN media m ON m.id = pi.media_id
    WHERE pi.playlist_id = p.id AND m.status = 'published'
    ORDER BY pi.added_at
    LIMIT 1
) f ON true
WHERE p.user_id = $1
ORDER BY p.updated_at DESC
LIMIT 100;

-- name: CountPlaylists :one
SELECT count(*) FROM playlists WHERE user_id = $1;

-- name: CreatePlaylist :one
INSERT INTO playlists (user_id, name) VALUES ($1, $2)
RETURNING id, name, item_count, updated_at;

-- Mọi câu lệnh trên một playlist đều kèm user_id: playlist của người khác coi như không tồn tại.
-- name: GetPlaylist :one
SELECT id, name, item_count, updated_at FROM playlists WHERE id = $1 AND user_id = $2;

-- Khoá dòng playlist tới hết transaction: hai request thêm mục cùng lúc phải chờ nhau, nên
-- giới hạn số mục và item_count luôn đúng.
-- name: LockPlaylist :one
SELECT id, item_count FROM playlists WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: RenamePlaylist :execrows
UPDATE playlists SET name = $3, updated_at = now() WHERE id = $1 AND user_id = $2;

-- name: DeletePlaylist :execrows
DELETE FROM playlists WHERE id = $1 AND user_id = $2;

-- name: ListPlaylistItems :many
SELECT sqlc.embed(m), sqlc.embed(c), pi.added_at
FROM playlist_items pi
JOIN media m ON m.id = pi.media_id
JOIN channels c ON c.id = m.channel_id
WHERE pi.playlist_id = $1 AND m.status = 'published'
ORDER BY pi.added_at
LIMIT 500;

-- name: AddPlaylistItem :execrows
INSERT INTO playlist_items (playlist_id, media_id)
SELECT sqlc.arg('playlist_id'), m.id FROM media m
WHERE m.slug = sqlc.arg('slug') AND m.status = 'published'
ON CONFLICT DO NOTHING;

-- name: RemovePlaylistItem :execrows
DELETE FROM playlist_items pi
USING media m
WHERE pi.media_id = m.id AND pi.playlist_id = $1 AND m.slug = $2;

-- name: AddPlaylistItemCount :exec
UPDATE playlists SET item_count = item_count + sqlc.arg('delta'), updated_at = now()
WHERE id = sqlc.arg('id');
