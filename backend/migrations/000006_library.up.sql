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
