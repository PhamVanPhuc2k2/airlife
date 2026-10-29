# Bài 0.12: Migration đầu tiên: tìm kiếm tiếng Việt không dấu

> [← Bài trước](11-lint-vuln-makefile.md) · [Mục lục](../README.md) · [Phần 01 →](../01-thuong-hieu-va-giao-dien/01-logo-va-favicon.md)

## Mục tiêu

Migration `000001_extensions` bật `unaccent` và `pg_trgm`, cùng hàm `immutable_unaccent` dùng
được trong index. Chạy bằng `make migrate`.

## Bạn sẽ học

- **Migration**: mọi thay đổi cấu trúc DB nằm trong file SQL có đánh số, commit vào git. Ai
  clone repo về chạy `make migrate` là có DB giống hệt.
- Mỗi migration có cặp `up` (làm) và `down` (hoàn tác).
- Vì sao `unaccent()` có sẵn **không** dùng được trong index, và cách vòng qua.

## Viết code

### Bước 1: golang-migrate chạy trong Docker

Không cài CLI lên máy. Service `migrate` trong `docker-compose.yml` (bài 0.10) dùng image chính
thức `migrate/migrate:v4.20.1`, mount `backend/migrations` vào `/migrations` và trỏ sẵn tới DB.
Makefile (bài 0.11) có `make migrate`, `make migrate-down`, `make migrate-new`.

### Bước 2: Tạo file migration

```bash
make migrate-new name=extensions
```

Lệnh sinh hai file rỗng `backend/migrations/000001_extensions.up.sql` và `.down.sql`. Số
`000001` tăng dần; golang-migrate ghi số đã chạy vào bảng `schema_migrations` và chỉ chạy
file có số **lớn hơn**.

### Bước 3: Vì sao cần hai extension này

Người Việt hay gõ không dấu. Khách gõ `pho ha noi` phải ra video "Phở Hà Nội".

- **`unaccent`**: `unaccent('Phở Hà Nội')` → `Pho Ha Noi`. So sánh hai bên đã bỏ dấu là khớp.
- **`pg_trgm`**: chia chuỗi thành cụm 3 ký tự để so khớp gần đúng (gõ sai một chữ vẫn ra), và
  quan trọng hơn: cho phép **index GIN** cho `ILIKE '%từ khoá%'`. Không có index, mỗi lần tìm là
  quét hết bảng.

Vấn đề: muốn index biểu thức `unaccent(title)` thì hàm phải là `IMMUTABLE` (cùng đầu vào luôn
cùng kết quả). `unaccent()` có sẵn được khai báo `STABLE`, vì từ điển bỏ dấu có thể bị đổi.
PostgreSQL từ chối: `functions in index expression must be marked IMMUTABLE`.

Cách vòng qua: bọc lại thành hàm của mình, khai báo `IMMUTABLE`, và **chỉ định cứng** từ điển
`public.unaccent` để kết quả thật sự cố định.

### `backend/migrations/000001_extensions.up.sql`

```sql
-- Extension dùng cho tìm kiếm tiếng Việt.
--
-- unaccent: bỏ dấu, "Phở Hà Nội" → "Pho Ha Noi", để gõ không dấu vẫn tìm ra.
-- pg_trgm:  so khớp gần đúng theo cụm 3 ký tự, gõ sai một chữ vẫn tìm ra,
--           và cho phép index GIN trên ILIKE '%từ khoá%'.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() có sẵn được khai báo STABLE (vì từ điển có thể đổi), nên PostgreSQL
-- KHÔNG cho dùng trong biểu thức index. Bọc lại thành hàm IMMUTABLE, chỉ định rõ
-- từ điển 'public.unaccent' để kết quả luôn cố định.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
```

### `backend/migrations/000001_extensions.down.sql`

Hoàn tác theo thứ tự **ngược** với `up`: hàm dùng extension, nên xoá hàm trước.

```sql
DROP FUNCTION IF EXISTS immutable_unaccent(text);
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS unaccent;
```

Phần tìm kiếm (Phần 02) sẽ dùng hàm này để tạo index, ví dụ:

```sql
CREATE INDEX media_title_search_idx ON media
  USING gin (immutable_unaccent(lower(title)) gin_trgm_ops);
```

## Kiểm tra

```bash
make up
make migrate
# 1/u extensions (…ms)
```

Thử hàm:

```bash
docker compose exec postgres psql -U airlife -Atc \
  "SELECT immutable_unaccent('Phở Hà Nội — Đà Lạt');"
# Pho Ha Noi - Da Lat
```

Thử `down` rồi `up` lại, để chắc file `down` đúng:

```bash
make migrate-down && make migrate
```

Chạy `make migrate` lần nữa: `no change`, vì migration 1 đã chạy rồi.

Để ý: `unaccent` đổi cả dấu gạch dài `—` thành `-`. Nó chuẩn hoá cả ký tự đặc biệt, không chỉ
bỏ dấu tiếng Việt. Chỉ dùng hàm này để **so sánh và index**, không dùng để hiển thị.

```bash
git add . && git commit -m "Migration đầu tiên: unaccent, pg_trgm"
```

Đến đây xong Phần 00. Kiểm tra cuối phần:

```bash
make up && make migrate && make lint && make vuln
curl -s localhost:8080/readyz   # {"data":{"postgres":"ok","rabbitmq":"ok","redis":"ok"}}
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `Dirty database version 1. Fix and force version.` | Migration lỗi giữa chừng. Sửa file SQL, rồi `docker compose run --rm migrate force 0` và `make migrate` lại |
| File do `make migrate-new` tạo thuộc root | Thiếu `user:` ở service `migrate`, hoặc `UID` trong `.env` gốc sai |
| **Sửa** một migration đã chạy | Đừng sửa. Migration đã chạy (nhất là đã lên production) là cố định; muốn đổi thì tạo migration mới |
