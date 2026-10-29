# Bài 2.02: sqlc: viết SQL, sinh code Go

> [← Bài trước](01-schema-noi-dung.md) · [Mục lục](../README.md) · [Bài sau →](03-du-lieu-mau-seed.md)

## Mục tiêu

Viết truy vấn bằng SQL thuần trong `backend/internal/db/queries/`, chạy `make sqlc` để có hàm Go
gọi được ngay, đúng kiểu, như `q.ListMediaNew(ctx, params)`.

## Bạn sẽ học

- Vì sao chọn sqlc thay vì ORM (GORM) hay viết tay `rows.Scan(...)`.
- Cú pháp `-- name:`, `:one`/`:many`/`:exec`, `sqlc.arg`/`sqlc.narg`.
- Tham số "có thể bỏ trống" bằng mẫu `(narg IS NULL OR cột = narg)`.

## Viết code

### Vì sao sqlc

| Cách | Vấn đề |
|---|---|
| Viết tay `rows.Scan(&a, &b, ...)` | Thêm một cột là phải sửa nhiều chỗ, sai thứ tự Scan chỉ phát hiện lúc chạy |
| ORM (GORM) | SQL bị giấu đi; truy vấn phức tạp (con trỏ phân trang, `&&` mảng) khó viết, khó biết nó sinh ra SQL gì |
| **sqlc** | Viết SQL thật, sqlc **đọc schema** (thư mục migrations) để kiểm tra cột có thật không, rồi sinh hàm Go đúng kiểu |

### Bước 1: `backend/sqlc.yaml`

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
            nullable: true
            go_type:
              type: time.Time
              pointer: true
```

- **`emit_pointers_for_null_types`**: cột cho phép NULL (`youtube_id text`) thành `*string`. Mặc định
  pgx dùng `pgtype.Text{String, Valid}`, dài dòng hơn.
- **`overrides`**: `uuid` → `uuid.UUID` của Google (thư viện UUID phổ biến nhất), `timestamptz` → `time.Time`.
  Có hai dòng cho mỗi kiểu: một cho cột NOT NULL, một (`nullable: true`) cho cột/tham số có thể NULL.

Cài thư viện UUID mà code sinh ra cần:

```bash
docker compose run --rm --no-deps api go get github.com/google/uuid@v1.6.0
```

### Bước 2: Chạy sqlc trong Docker

sqlc dùng thư viện C để đọc cú pháp PostgreSQL, không chạy được bằng `go run` trong image golang
alpine. Dùng image chính thức. Thêm vào `docker-compose.yml` (trước `postgres:`):

```yaml
  # Sinh code Go từ SQL: make sqlc. Image chính thức của sqlc (cần CGO, không chạy được bằng
  # `go run` trong image golang alpine).
  sqlc:
    image: sqlc/sqlc:1.31.1
    profiles: ["tools"]
    user: "${UID:-1000}:${GID:-1000}"
    working_dir: /src
    volumes:
      - ./backend:/src
    command: ["generate"]
```

Thêm vào `Makefile` (và thêm `sqlc seed` vào dòng `.PHONY`):

```makefile
sqlc: ## Sinh code Go từ backend/internal/db/queries/*.sql
	$(COMPOSE) run --rm sqlc generate

seed: ## Nạp dữ liệu mẫu (chỉ môi trường dev)
	$(COMPOSE) run --rm api go run ./cmd/seed
```

### Bước 3: `backend/internal/db/queries/content.sql`

```sql
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
```

**Mẫu tham số tuỳ chọn**:

```sql
AND (sqlc.narg('category')::text IS NULL OR m.category_slug = sqlc.narg('category'))
```

Go truyền `nil` thì vế đầu đúng, điều kiện bỏ qua; truyền `&"xem"` thì lọc theo chuyên mục. Một
truy vấn phục vụ mọi tổ hợp bộ lọc, không phải ghép chuỗi SQL (ghép chuỗi là mở cửa cho SQL injection).
`::text` báo sqlc kiểu của tham số, vì từ `NULL` nó không đoán được.

### Bước 4: `backend/internal/db/queries/seed.sql`

```sql
-- Truy vấn cho cmd/seed: nạp dữ liệu mẫu. "Upsert" (ON CONFLICT … DO UPDATE): chạy seed
-- nhiều lần không bị trùng, chỉ cập nhật lại nội dung.

-- name: UpsertCategory :exec
INSERT INTO categories (slug, name, icon, title, description, sort_order)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, icon = EXCLUDED.icon, title = EXCLUDED.title,
    description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- name: UpsertCategoryFilter :exec
INSERT INTO category_filters (category_slug, slug, name, sort_order)
VALUES ($1, $2, $3, $4)
ON CONFLICT (category_slug, slug) DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- name: UpsertChannel :one
INSERT INTO channels (slug, name, type, verified, followers_count, description)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, type = EXCLUDED.type, verified = EXCLUDED.verified,
    followers_count = EXCLUDED.followers_count, description = EXCLUDED.description,
    updated_at = now()
RETURNING id;

-- name: UpsertMedia :exec
INSERT INTO media (slug, kind, category_slug, channel_id, title, description, group_label,
                   genre_label, tags, youtube_id, thumbnail_url, duration_seconds,
                   episode_count, view_count, featured, lineup_month, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (slug) DO UPDATE
SET kind = EXCLUDED.kind, category_slug = EXCLUDED.category_slug,
    channel_id = EXCLUDED.channel_id, title = EXCLUDED.title,
    description = EXCLUDED.description, group_label = EXCLUDED.group_label,
    genre_label = EXCLUDED.genre_label, tags = EXCLUDED.tags,
    -- Giữ youtube_id đã gắn tay nếu dữ liệu mẫu không có
    youtube_id = COALESCE(EXCLUDED.youtube_id, media.youtube_id),
    thumbnail_url = EXCLUDED.thumbnail_url, duration_seconds = EXCLUDED.duration_seconds,
    episode_count = EXCLUDED.episode_count, featured = EXCLUDED.featured,
    lineup_month = EXCLUDED.lineup_month, updated_at = now();
```

`EXCLUDED` là dòng **định chèn** bị trùng; `DO UPDATE SET name = EXCLUDED.name` = ghi đè bằng giá trị mới.

### Bước 5: Sinh code

```bash
make sqlc
ls backend/internal/db       # db.go  models.go  content.sql.go  seed.sql.go  queries/
```

Mở `content.sql.go` xem: mỗi truy vấn thành một hàm, tham số gom vào struct:

```go
type ListMediaNewParams struct {
	Category    *string
	Tag         *string
	LineupMonth *time.Time
	CursorTime  *time.Time
	CursorID    *uuid.UUID
	Limit       int32
}
```

**Không sửa tay** các file này; sửa SQL rồi `make sqlc` lại. Code sinh ra **có commit** vào git (để
build không cần chạy sqlc).

## Kiểm tra

```bash
make sqlc && cd backend && go build ./... && cd ..
```

Thử gõ sai tên cột trong `content.sql` (`m.titel`), chạy `make sqlc`:

```text
internal/db/queries/content.sql:…: column "titel" does not exist
```

sqlc bắt lỗi **trước khi** chạy. Sửa lại.

```bash
git add . && git commit -m "sqlc: truy vấn nội dung"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Tham số ra kiểu `pgtype.Timestamptz` thay vì `*time.Time` | Thiếu override `nullable: true` cho kiểu đó |
| `could not determine data type of parameter $1` | Thêm ép kiểu: `sqlc.narg('x')::text` |
| File sinh ra thuộc root | Thiếu `user:` ở service `sqlc` |
