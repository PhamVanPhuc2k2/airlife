# Bài 3.02: Schema và truy vấn tin tức, tháng line-up

> [← Bài trước](01-phan-trang-chung-va-loc-html.md) · [Mục lục](../README.md) · [Bài sau →](03-seed-tin-tuc.md)

## Mục tiêu

Migration `000003_news` (bảng `news_categories`, `news`), truy vấn sqlc cho tin tức và cho danh sách
các tháng có line-up phim.

## Bạn sẽ học

- Danh sách **không lấy cột nặng** (`body_html`); chỉ trang chi tiết mới lấy.
- Sắp xếp "ưu tiên cùng chuyên mục" bằng `ORDER BY (điều kiện) DESC`.
- Thêm override sqlc khi gặp kiểu mới.

## Viết code

### Bước 1: `backend/migrations/000003_news.up.sql`

```bash
make migrate-new name=news
```

```sql
-- Tin tức: Khám phá, Sự kiện, Mẹo bay, Line-up phim, Kinh doanh (giữ từ site cũ skyline.vn).

CREATE TABLE news_categories (
    slug        text PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    sort_order  smallint NOT NULL DEFAULT 0
);

CREATE TABLE news (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          text NOT NULL UNIQUE,
    category_slug text NOT NULL REFERENCES news_categories (slug),
    title         text NOT NULL,
    -- Đoạn tóm tắt: hiện ở thẻ bài viết và làm mô tả khi chia sẻ link
    excerpt       text NOT NULL DEFAULT '',
    -- Thân bài HTML ĐÃ LỌC bằng bluemonday (pkg/sanitize) trước khi ghi. Không bao giờ ghi
    -- HTML chưa lọc vào cột này: frontend hiển thị nó nguyên văn.
    body_html     text NOT NULL DEFAULT '',
    cover_url     text NOT NULL,
    author        text NOT NULL DEFAULT 'Airlife',
    status        text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
    published_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Danh sách tất cả bài mới nhất, và theo từng chuyên mục (phân trang con trỏ)
CREATE INDEX news_new_idx ON news (published_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX news_category_new_idx ON news (category_slug, published_at DESC, id DESC)
    WHERE status = 'published';
CREATE INDEX news_title_search_idx ON news
    USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
```

- **`body_html`**: comment nói rõ cột này chỉ chứa HTML **đã lọc**. Người viết code sau đọc schema là biết luật.
- **`status` có `draft`**: bài nháp (biên tập viên đang viết) không hiện ra ngoài.
- Hai index: danh sách tất cả bài, và danh sách theo chuyên mục; cả hai khớp thứ tự `published_at DESC, id DESC`.

#### `backend/migrations/000003_news.down.sql`

```sql
DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS news_categories;
```

### Bước 2: `backend/internal/db/queries/news.sql`

```sql
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
```

- **`ListNews` không có `body_html`**: thân bài có thể dài hàng chục KB; trang danh sách 12 bài không
  cần gửi 12 thân bài.
- **`ORDER BY (n.category_slug = $category) DESC`**: biểu thức so sánh cho ra `true`/`false`; sắp
  giảm dần thì `true` lên trước. Bài cùng chuyên mục đứng đầu, sau đó mới tới bài khác.

### Bước 3: Tháng line-up

Thêm vào cuối `backend/internal/db/queries/content.sql` (truy vấn bảng `media`, nên nằm cùng các truy
vấn media):

```sql
-- Các tháng có line-up phim (mới nhất trước), cho bộ chọn tháng ở trang Mới tải.
-- name: ListLineupMonths :many
SELECT DISTINCT lineup_month::date AS month
FROM media
WHERE lineup_month IS NOT NULL AND status = 'published'
ORDER BY month DESC;
```

### Bước 4: Truy vấn seed

Thêm vào cuối `backend/internal/db/queries/seed.sql`:

```sql
-- name: UpsertNewsCategory :exec
INSERT INTO news_categories (slug, name, description, sort_order)
VALUES ($1, $2, $3, $4)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- name: UpsertNews :exec
INSERT INTO news (slug, category_slug, title, excerpt, body_html, cover_url, author, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (slug) DO UPDATE
SET category_slug = EXCLUDED.category_slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
    body_html = EXCLUDED.body_html, cover_url = EXCLUDED.cover_url, author = EXCLUDED.author,
    published_at = EXCLUDED.published_at, updated_at = now();
```

### Bước 5: Override cho kiểu `date`

Chạy `make sqlc` lần đầu, `ListLineupMonths` ra `[]pgtype.Date`: sqlc mới có override cho `date`
**có thể NULL**, chưa có cho `date` NOT NULL. Thêm vào `overrides` của `backend/sqlc.yaml`:

```yaml
# sqlc: viết SQL thuần trong internal/db/queries/*.sql → sinh code Go có kiểu vào internal/db.
# Chạy: make sqlc. KHÔNG sửa tay các file *.sql.go do sqlc sinh ra.
version: "2"
sql:
  - engine: postgresql
    # sqlc đọc migrations/*.up.sql để biết cấu trúc bảng (bỏ qua *.down.sql)
    schema: migrations
    queries: internal/db/queries
    gen:
      go:
        package: db
        out: internal/db
        sql_package: pgx/v5
        # Cột NULL được thì thành con trỏ (*string, *int32) thay vì pgtype.Text…: dễ dùng hơn
        emit_pointers_for_null_types: true
        # Không có dòng nào thì trả slice rỗng [] chứ không phải nil (JSON ra [] thay vì null)
        emit_empty_slices: true
        overrides:
          - db_type: uuid
            go_type: github.com/google/uuid.UUID
          - db_type: uuid
            nullable: true
            go_type:
              import: github.com/google/uuid
              type: UUID
              pointer: true
          - db_type: timestamptz
            go_type: time.Time
          - db_type: timestamptz
            nullable: true
            go_type:
              type: time.Time
              pointer: true
          - db_type: date
            go_type: time.Time
          - db_type: date
            nullable: true
            go_type:
              type: time.Time
              pointer: true
```

```bash
make sqlc
grep -n "func (q \*Queries) ListLineupMonths" backend/internal/db/content.sql.go
# ... ListLineupMonths(ctx context.Context) ([]time.Time, error)
```

## Kiểm tra

```bash
make migrate && make migrate-down && make migrate     # 3/u news  3/d news  3/u news
make sqlc && cd backend && go build ./... && cd ..
git add . && git commit -m "Schema và truy vấn tin tức"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `relation "news_categories" does not exist` khi tạo `news` | Tạo bảng được tham chiếu trước |
| Kiểu sinh ra là `pgtype.X` | Thiếu override cho kiểu đó (NOT NULL và NULL là hai override khác nhau) |
