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
