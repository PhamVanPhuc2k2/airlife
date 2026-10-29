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
