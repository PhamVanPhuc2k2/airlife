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
