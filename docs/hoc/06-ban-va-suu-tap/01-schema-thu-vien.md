# Bài 6.01: Schema thư viện cá nhân: lịch sử xem, đã lưu, playlist

> [← Phần 05](../05-kenh-va-binh-luan/08-binh-luan-noi-bat-va-menu.md) · [Mục lục](../README.md) · [Bài sau →](02-module-thu-vien.md)

## Mục tiêu

Migration `000006_library` và truy vấn sqlc cho trang Bạn và Sưu tập: lịch sử xem (để "Tiếp tục xem",
"Đã xem"), nội dung đã lưu, playlist riêng.

## Bạn sẽ học

- Lịch sử xem là **một dòng cho mỗi (người, media)**, cập nhật liên tục, không phải mỗi lần xem một dòng.
- `sqlc.embed`: lấy cả dòng của một bảng thành một struct, dùng chung một hàm chuyển đổi.
- `INSERT ... SELECT` từ slug: một câu vừa tìm media vừa ghi, không cần truy vấn id trước.
- `LEFT JOIN LATERAL`: lấy "mục đầu tiên" của mỗi playlist trong cùng một truy vấn.
- `SELECT ... FOR UPDATE`: khoá dòng để hai request cùng lúc không làm sai số đếm.

## Viết code

### Bước 1: Migration

```bash
make migrate-new name=library
```

`backend/migrations/000006_library.up.sql`:

```sql
-- Thư viện cá nhân (trang Bạn, Sưu tập): lịch sử xem, đã lưu, playlist.
-- Mọi bảng đều của riêng từng người: xoá tài khoản là xoá theo (ON DELETE CASCADE).

-- Lịch sử xem: MỘT dòng cho mỗi (người, media), cập nhật tiến độ khi đang xem.
-- "Tiếp tục xem" = những dòng xem dở; "Đã xem" = mọi dòng, mới xem nhất trước.
CREATE TABLE watch_history (
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_id         uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    -- Tổng thời lượng lấy từ trình phát YouTube (chính xác hơn media.duration_seconds, và có cả
    -- với phim bộ, vốn chỉ có số tập)
    position_seconds integer NOT NULL CHECK (position_seconds >= 0),
    duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id),
    CHECK (position_seconds <= duration_seconds)
);
CREATE INDEX watch_history_user_idx ON watch_history (user_id, updated_at DESC, media_id DESC);

CREATE TABLE saved_media (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    media_id   uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);
CREATE INDEX saved_media_user_idx ON saved_media (user_id, created_at DESC, media_id DESC);

-- Playlist riêng tư: chỉ chủ playlist xem được (chưa có chia sẻ).
CREATE TABLE playlists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    -- Cột đếm: lưới playlist hiện "4 mục" mà không phải COUNT từng playlist
    item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlists_user_idx ON playlists (user_id, updated_at DESC);

CREATE TABLE playlist_items (
    playlist_id uuid NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    media_id    uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    added_at    timestamptz NOT NULL DEFAULT now(),
    -- Một media có mặt trong một playlist tối đa một lần
    PRIMARY KEY (playlist_id, media_id)
);
```

`backend/migrations/000006_library.down.sql`:

```sql
DROP TABLE IF EXISTS playlist_items;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS saved_media;
DROP TABLE IF EXISTS watch_history;
```

- **`duration_seconds` của lịch sử lấy từ trình phát**, không dùng `media.duration_seconds`: phim bộ chỉ có
  số tập, và thời lượng trên trình phát YouTube mới đúng với video thật.
- **Khoá chính `(user_id, media_id)`**: xem lại một phim thì cập nhật dòng cũ (`ON CONFLICT DO UPDATE`),
  bảng không phình theo số lần xem.
- **Chỉ mục `(user_id, updated_at DESC, media_id DESC)`** khớp đúng thứ tự sắp xếp và con trỏ của "Đã xem".

```bash
make migrate
```

### Bước 2: Truy vấn, `backend/internal/db/queries/library.sql`

```sql
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
       (SELECT count(*) FROM watch_history h WHERE h.user_id = sqlc.arg('user_id')) AS watched;

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
```

- **`sqlc.embed(m), sqlc.embed(c)`**: dòng kết quả có trường `Medium db.Medium` và `Channel db.Channel`.
  Bốn danh sách (đã xem, tiếp tục xem, đã lưu, mục playlist) cùng đổi sang thẻ media bằng một hàm
  `media.CardOf` (bài 6.02), thay vì mỗi truy vấn một kiểu `...Row` riêng phải chép tay từng cột.
- **`INSERT ... SELECT ... FROM media WHERE slug = ...`**: media không tồn tại thì `SELECT` không ra dòng
  nào, câu lệnh thêm 0 dòng. `:execrows` trả số dòng để service phân biệt.
- **Ngưỡng "xem dở"**: qua 30 giây đầu (mở nhầm không tính) và chưa tới 95% (đang chạy chữ cuối phim coi
  như xem xong).
- **`GetMediaLibraryState`**: một truy vấn trả cả ba thứ trang xem cần (đã lưu chưa, xem tới đâu, nằm
  trong playlist nào), thay vì ba request.
- **Mọi câu về playlist đều có `user_id`**: đoán được id playlist của người khác cũng chỉ nhận "không có".
- **`LockPlaylist ... FOR UPDATE`**: dùng ở bài 6.02 để giới hạn 200 mục luôn đúng.

Truy vấn kênh đang theo dõi lấy thêm cột cho lưới kênh ở trang Bạn. Trong
`backend/internal/db/queries/channels.sql`, sửa dòng `SELECT` của `ListFollowing`:

```sql
SELECT c.slug, c.name, c.type, c.verified, c.followers_count, c.avatar_url
```

```bash
make sqlc
```

## Kiểm tra

```bash
make psql
```

```sql
\dt
-- có watch_history, saved_media, playlists, playlist_items
\q
```

```bash
grep -n "type ListWatchHistoryRow" -A6 backend/internal/db/library.sql.go
# Medium Medium / Channel Channel / PositionSeconds int32 ...
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `make sqlc`: `column reference "user_id" is ambiguous` ở `GetLibraryStats` | Bản đầu viết `WHERE user_id = $1` trong cả bốn truy vấn con; sqlc không biết `$1` thuộc bảng nào. Đặt bí danh bảng (`cf.user_id`, `s.user_id`…) và dùng `sqlc.arg('user_id')` |
| Lấy danh sách playlist lỗi `cannot scan NULL into *string` khi có playlist rỗng | Cột lấy từ `LEFT JOIN LATERAL` có thể NULL nhưng sqlc sinh kiểu `string`. Bọc `COALESCE(..., '')::text` như trong file trên |
| `\dt` không thấy bảng mới | Quên `make migrate` |
