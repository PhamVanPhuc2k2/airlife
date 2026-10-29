# Bài 5.01: Schema theo dõi kênh và bình luận

> [← Phần 04](../04-dang-nhap-tai-khoan/12-frontend-xac-minh-dat-lai.md) · [Mục lục](../README.md) · [Bài sau →](02-module-kenh.md)

## Mục tiêu

Migration `000005_social`: bảng `channel_followers`, `comments`, `comment_likes`, và các truy vấn sqlc cho
kênh và bình luận.

## Bạn sẽ học

- Khoá chính ghép để database tự chặn "theo dõi hai lần", "thích hai lần".
- Một bình luận thuộc media **hoặc** bài viết: hai cột khoá ngoại và `CHECK`.
- Cột đếm (`like_count`, `reply_count`) thay vì `COUNT(*)` mỗi lần hiện.
- Partial index: chỉ đánh chỉ mục những dòng hay được truy vấn.
- `:execrows` của sqlc: biết câu lệnh có thật sự thêm/xoá dòng nào không.

## Viết code

### Bước 1: Migration

```bash
make migrate-new name=social
```

`backend/migrations/000005_social.up.sql`:

```sql
-- Theo dõi kênh và bình luận.

CREATE TABLE channel_followers (
    channel_id uuid NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Khoá chính ghép: mỗi người theo dõi một kênh tối đa MỘT lần, database tự chặn trùng
    PRIMARY KEY (channel_id, user_id)
);
-- "Kênh tôi đang theo dõi" (menu dọc)
CREATE INDEX channel_followers_user_idx ON channel_followers (user_id, created_at DESC);

-- Bình luận cho video/âm thanh HOẶC bài viết. Hai cột khoá ngoại thay vì một cặp
-- (target_type, target_id): giữ được REFERENCES, xoá media là bình luận theo đó bị xoá (CASCADE).
CREATE TABLE comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id    uuid REFERENCES media (id) ON DELETE CASCADE,
    news_id     uuid REFERENCES news (id) ON DELETE CASCADE,
    -- Trả lời chỉ một cấp (như mockup): parent_id luôn là bình luận gốc
    parent_id   uuid REFERENCES comments (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Chữ thường, KHÔNG nhận HTML: frontend hiện như văn bản, nên không cần lọc như bài viết
    body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    -- Đếm sẵn (denormalize) để danh sách không phải COUNT(*) mỗi lần; cập nhật cùng transaction
    like_count  integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
    reply_count integer NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
    -- deleted: người viết xoá; hidden: kiểm duyệt ẩn (Phần 12). Không xoá hẳn để giữ lịch sử
    status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((media_id IS NULL) <> (news_id IS NULL))
);
CREATE INDEX comments_media_new_idx ON comments (media_id, created_at DESC, id DESC)
    WHERE parent_id IS NULL AND status = 'visible';
CREATE INDEX comments_news_new_idx ON comments (news_id, created_at DESC, id DESC)
    WHERE parent_id IS NULL AND status = 'visible';
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at, id) WHERE status = 'visible';
-- Bình luận nổi bật ở trang chủ (nhiều lượt thích / nhiều trả lời)
CREATE INDEX comments_hot_idx ON comments (like_count DESC) WHERE parent_id IS NULL AND status = 'visible';

CREATE TABLE comment_likes (
    comment_id uuid NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);
```

`backend/migrations/000005_social.down.sql`:

```sql
DROP TABLE IF EXISTS comment_likes;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS channel_followers;
```

- **Hai cột `media_id`, `news_id`** thay vì cặp `(target_type, target_id)`: cặp kia không gắn được
  `REFERENCES`, nên xoá media thì bình luận mồ côi vẫn nằm lại. `CHECK ((media_id IS NULL) <> (news_id IS NULL))`
  bắt buộc có đúng một trong hai.
- **Trả lời một cấp**: `parent_id` luôn trỏ tới bình luận gốc (code ở bài 5.03 lo việc này).
- **`status` thay vì xoá hẳn**: xoá một bình luận gốc có trả lời thì các trả lời vẫn còn ngữ cảnh; biên
  tập viên có thể ẩn (`hidden`) mà không mất dữ liệu.
- **Partial index `WHERE status = 'visible'`**: chỉ mục chỉ chứa bình luận đang hiện, nhỏ hơn và đúng
  với điều kiện của mọi truy vấn danh sách.

```bash
make migrate
```

### Bước 2: Truy vấn kênh, `backend/internal/db/queries/channels.sql`

```sql
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
```

- **`FollowChannel :execrows`** với `ON CONFLICT DO NOTHING`: theo dõi lần hai không lỗi, chỉ trả về
  `0` dòng. Service dựa vào con số này để quyết định có cộng `followers_count` hay không.
- **`AddChannelFollowers ... RETURNING`**: cộng và đọc số mới trong một câu, không cần `SELECT` lại.

### Bước 3: Truy vấn bình luận, `backend/internal/db/queries/comments.sql`

```sql
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
```

- **Hai cách sắp xếp, hai kiểu con trỏ**: "Hay" theo `(like_count, id)`, "Mới" theo `(created_at, id)`;
  cùng kỹ thuật phân trang con trỏ của bài 2.05.
- **`LikedComments` nhận `ids::uuid[]`** và lọc `= ANY(...)`: một truy vấn cho cả trang 20 bình luận
  (bài 5.03 giải thích vì sao).
- **`ListHotComments`** dùng `sqlc.arg('by_replies')::bool` trong `ORDER BY CASE`: một truy vấn cho
  hai tab "Hay" và "Nhiều" ở trang chủ.

### Bước 4: Truy vấn phụ

Thêm vào cuối `backend/internal/db/queries/news.sql` (bình luận bài viết cần id từ slug):

```sql
-- name: GetNewsIDBySlug :one
SELECT id FROM news WHERE slug = $1 AND status = 'published';
```

Trang kênh cần danh sách media của một kênh. Thêm một điều kiện vào **cả hai** truy vấn `ListMediaNew` và
`ListMediaPopular` trong `backend/internal/db/queries/content.sql`, ngay sau dòng lọc `tag`:

```sql
  AND (sqlc.narg('channel')::text IS NULL OR c.slug = sqlc.narg('channel'))
```

```bash
make sqlc
```

## Kiểm tra

```bash
make psql
```

```sql
\d comments
-- Thử CHECK: bình luận không gắn vào đâu cả
INSERT INTO comments (user_id, body) SELECT id, 'thử' FROM users LIMIT 1;
-- ERROR:  new row for relation "comments" violates check constraint "comments_check"
\q
```

```bash
cd backend && go build ./... && cd ..
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `go build` báo thiếu trường `Channel` trong `ListMediaNewParams` | Mới thêm điều kiện vào một trong hai truy vấn, hoặc quên `make sqlc` |
| `make migrate-down` lỗi vì bảng còn khoá ngoại | File down phải xoá `comment_likes` trước `comments` |
