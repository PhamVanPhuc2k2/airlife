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
