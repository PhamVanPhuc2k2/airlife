# Bài 2.01: Schema nội dung: chuyên mục, kênh, media

> [← Phần 01](../01-thuong-hieu-va-giao-dien/08-ghep-khung-appshell.md) · [Mục lục](../README.md) · [Bài sau →](02-sqlc.md)

## Mục tiêu

Migration `000002_content` tạo 4 bảng cho mục Xem/Nghe: `categories`, `category_filters`,
`channels`, `media`, cùng các index cho danh sách, lọc và tìm kiếm.

## Bạn sẽ học

- Đọc dữ liệu mockup để **suy ra** bảng: trường nào thành cột, trường nào cần tách bảng.
- Dùng `CHECK` để database tự chặn dữ liệu sai, thay vì tin hết vào code.
- Mảng `text[]` + index GIN để lọc theo nhiều nhãn.
- Index một phần (`WHERE status = 'published'`) và index cho phân trang con trỏ.

## Viết code

### Bước 1: Từ mockup ra bảng

Một media trong `skyline/data/content.json`:

```json
{ "id": "v01", "kind": "video", "cat": "xem", "group": "Phim nước ngoài", "genre": "Hành động",
  "title": "Vùng Trời Cuối Cùng", "channel": "skyline", "duration": "2:08:14", "views": 1840000,
  "date": "2 ngày trước", "featured": true, "lineup": true }
```

| Mockup | Bảng | Ghi chú |
|---|---|---|
| `id: "v01"` | `id uuid` + `slug text UNIQUE` | URL dùng slug dễ đọc: `/xem/vung-troi-cuoi-cung` |
| `cat` | `category_slug` → bảng `categories` | Khoá ngoại: không thể gán chuyên mục không tồn tại |
| `group`, `genre` | `group_label`, `genre_label` + `tags text[]` | Nhãn để hiển thị; `tags` (slug) để lọc theo chip |
| `channel` | `channel_id` → bảng `channels` | |
| `duration: "2:08:14"` / `"10 tập"` | `duration_seconds` / `episode_count` | Lưu số, không lưu chuỗi: sắp xếp, tính toán được |
| `views` | `view_count bigint` | |
| `date: "2 ngày trước"` | `published_at timestamptz` | "2 ngày trước" là cách **hiển thị**; lưu thời điểm thật |
| `lineup: true` | `lineup_month date` | Line-up theo tháng của site cũ: biết phim thuộc line-up tháng nào |
| (YouTube) | `youtube_id` | Mockup không có; dự án chốt dùng YouTube |

Chip lọc của chuyên mục Xem trộn cả nhóm ("Phim Việt") lẫn thể loại ("Hành động"). Thay vì hai cột
và hai kiểu lọc, mỗi media có mảng `tags = {phim-viet, hanh-dong}`; chip nào cũng là "media có tag X".

### Bước 2: `backend/migrations/000002_content.up.sql`

```bash
make migrate-new name=content
```

```sql
-- Nội dung Xem/Nghe: chuyên mục, kênh, media (video & âm thanh nhúng từ YouTube).

-- Chuyên mục: xem, nghe, kinh-doanh, tour-bay. Khoá chính là slug vì nó ổn định, nằm
-- trên URL (/xem, /nghe) và dễ đọc khi truy vấn tay.
CREATE TABLE categories (
    slug        text PRIMARY KEY,
    name        text NOT NULL,
    icon        text NOT NULL,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    sort_order  smallint NOT NULL DEFAULT 0
);

-- Chip lọc trong trang chuyên mục ("Phim Việt", "Podcast"…). Media khớp một chip khi
-- mảng media.tags có chứa slug của chip.
CREATE TABLE category_filters (
    id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_slug text NOT NULL REFERENCES categories (slug) ON DELETE CASCADE,
    slug          text NOT NULL,
    name          text NOT NULL,
    sort_order    smallint NOT NULL DEFAULT 0,
    UNIQUE (category_slug, slug)
);

-- Kênh: nhà phân phối nội dung, nhà sáng tạo, doanh nghiệp.
CREATE TABLE channels (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE,
    name            text NOT NULL,
    type            text NOT NULL CHECK (type IN ('distributor', 'creator', 'business', 'travel')),
    verified        boolean NOT NULL DEFAULT false,
    followers_count bigint NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
    description     text NOT NULL DEFAULT '',
    avatar_url      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             text NOT NULL UNIQUE,
    kind             text NOT NULL CHECK (kind IN ('video', 'audio')),
    category_slug    text NOT NULL REFERENCES categories (slug),
    channel_id       uuid NOT NULL REFERENCES channels (id),
    title            text NOT NULL,
    description      text NOT NULL DEFAULT '',
    -- Nhãn hiển thị: "Phim nước ngoài · Hành động"
    group_label      text NOT NULL DEFAULT '',
    genre_label      text NOT NULL DEFAULT '',
    -- Slug dùng để lọc theo chip: {phim-nuoc-ngoai, hanh-dong}
    tags             text[] NOT NULL DEFAULT '{}',
    -- NULL khi chưa gắn video YouTube (dữ liệu mẫu); trang xem sẽ báo "chưa có video"
    youtube_id       text CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
    thumbnail_url    text NOT NULL,
    -- Phim lẻ, nhạc, podcast: thời lượng (giây). Series: số tập. Đúng một trong hai có giá trị.
    duration_seconds integer CHECK (duration_seconds > 0),
    episode_count    integer CHECK (episode_count > 0),
    view_count       bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    featured         boolean NOT NULL DEFAULT false,
    -- Line-up phim theo tháng (giữ từ site cũ): ngày đầu tháng, vd. 2026-10-01
    lineup_month     date CHECK (lineup_month = date_trunc('month', lineup_month)::date),
    status           text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
    published_at     timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((duration_seconds IS NULL) <> (episode_count IS NULL))
);

-- Danh sách theo chuyên mục, mới nhất trước (phân trang kiểu con trỏ theo published_at, id)
CREATE INDEX media_category_new_idx ON media (category_slug, published_at DESC, id DESC)
    WHERE status = 'published';
-- Danh sách xem nhiều nhất
CREATE INDEX media_category_popular_idx ON media (category_slug, view_count DESC, id DESC)
    WHERE status = 'published';
-- Lọc theo chip: tags @> '{hanh-dong}'
CREATE INDEX media_tags_idx ON media USING gin (tags);
CREATE INDEX media_channel_idx ON media (channel_id, published_at DESC);
CREATE INDEX media_lineup_idx ON media (lineup_month) WHERE lineup_month IS NOT NULL;
-- Tìm kiếm tiếng Việt không dấu (hàm immutable_unaccent ở migration 000001)
CREATE INDEX media_title_search_idx ON media
    USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
```

Điểm chính:

- **`CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$')`**: ID video YouTube luôn là 11 ký tự chữ, số, `_`, `-`.
  Dán nhầm cả link `https://youtu.be/...` là database từ chối ngay.
- **`CHECK ((duration_seconds IS NULL) <> (episode_count IS NULL))`**: đúng **một** trong hai có giá
  trị. `<>` giữa hai boolean là phép "khác nhau" (XOR).
- **`lineup_month = date_trunc('month', lineup_month)::date`**: chỉ nhận ngày đầu tháng.
- **`status`** thay vì xoá hẳn: ẩn một video mà vẫn giữ lượt xem, bình luận.
- **`GENERATED ALWAYS AS IDENTITY`**: cách chuẩn mới của PostgreSQL thay cho `serial`.
- **Index một phần** `WHERE status = 'published'`: index chỉ chứa media đang hiện (đúng thứ mọi truy
  vấn công khai cần), nhỏ và nhanh hơn.
- **Index `(category_slug, published_at DESC, id DESC)`** khớp đúng thứ tự sắp xếp của danh sách, để
  PostgreSQL đọc thẳng theo index, không phải sắp xếp lại. Bài 2.05 giải thích vì sao có `id`.
- **`USING gin (tags)`**: index cho phép toán `tags @> '{hanh-dong}'` (mảng có chứa).
- **Index tìm kiếm** dùng hàm `immutable_unaccent` của bài 0.12.

### Bước 3: `backend/migrations/000002_content.down.sql`

```sql
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS category_filters;
DROP TABLE IF EXISTS categories;
```

Xoá theo thứ tự ngược: `media` tham chiếu `channels` và `categories`, nên xoá `media` trước.

## Kiểm tra

```bash
make migrate                # 2/u content
make migrate-down && make migrate
make psql
```

Trong psql:

```sql
\d media
-- Thử ràng buộc:
INSERT INTO categories (slug, name, icon, title) VALUES ('thu', 'Thử', 'x', 'Thử');
INSERT INTO channels (slug, name, type) VALUES ('kenh-thu', 'Kênh thử', 'creator');
INSERT INTO media (slug, kind, category_slug, channel_id, title, thumbnail_url, youtube_id, duration_seconds)
VALUES ('a', 'video', 'thu', (SELECT id FROM channels WHERE slug = 'kenh-thu'), 'A', 'x', 'https://youtu.be/abc', 60);
-- ERROR: new row for relation "media" violates check constraint "media_youtube_id_check"
DELETE FROM channels WHERE slug = 'kenh-thu'; DELETE FROM categories WHERE slug = 'thu';
\q
```

```bash
git add . && git commit -m "Schema nội dung: chuyên mục, kênh, media"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `function gen_random_uuid() does not exist` | PostgreSQL dưới 13. Dự án dùng 18 nên có sẵn |
| `functions in index expression must be marked IMMUTABLE` | Dùng `unaccent()` thay vì `immutable_unaccent()` (bài 0.12) |
| `Dirty database version 2` | Migration lỗi giữa chừng: sửa SQL, `docker compose run --rm migrate force 1`, rồi `make migrate` |
