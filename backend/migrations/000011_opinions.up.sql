-- Ý kiến (Phần 11): trải nghiệm chuyến bay, khảo sát, góp ý.

-- Trải nghiệm: bài chia sẻ ngắn về một chặng bay. Chưa có ảnh (tải ảnh lên R2 làm ở Phần 12).
CREATE TABLE experiences (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    route      text NOT NULL CHECK (char_length(route) BETWEEN 3 AND 40),
    rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body       text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
    like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
    -- deleted: người viết xoá; hidden: kiểm duyệt ẩn (Phần 12)
    status     text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiences_feed_idx ON experiences (created_at DESC, id DESC) WHERE status = 'visible';

CREATE TABLE experience_likes (
    experience_id uuid NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_id, user_id)
);

-- Khảo sát: câu hỏi + các phương án. Mỗi người bình chọn MỘT lần cho mỗi khảo sát.
CREATE TABLE surveys (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question   text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 200),
    -- closed: vẫn xem được kết quả nhưng không bình chọn thêm
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'hidden')),
    position   integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE survey_options (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    label     text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
    position  integer NOT NULL,
    UNIQUE (survey_id, position),
    -- Để survey_votes tham chiếu được cặp (phương án, khảo sát)
    UNIQUE (id, survey_id)
);

CREATE TABLE survey_votes (
    survey_id  uuid NOT NULL,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    option_id  uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Khoá chính (survey_id, user_id): database tự bảo đảm một người một phiếu mỗi khảo sát,
    -- dù hai request đến cùng lúc.
    PRIMARY KEY (survey_id, user_id),
    -- Khoá ngoại ghép: phương án phải THUỘC khảo sát này, không thể gửi option của khảo sát khác.
    FOREIGN KEY (option_id, survey_id) REFERENCES survey_options (id, survey_id) ON DELETE CASCADE
);
CREATE INDEX survey_votes_option_idx ON survey_votes (option_id);

-- Góp ý: khách vãng lai gửi được (user_id rỗng), nên có Turnstile chống bot.
CREATE TABLE feedbacks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    topic       text NOT NULL CHECK (topic IN ('content', 'shop', 'tour', 'utility', 'website', 'other')),
    rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 3000),
    flight_code text CHECK (flight_code IS NULL OR char_length(flight_code) BETWEEN 3 AND 10),
    email       citext CHECK (email IS NULL OR char_length(email) <= 254),
    -- new → đã xử lý ở trang quản trị (Phần 12)
    status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedbacks_new_idx ON feedbacks (created_at DESC) WHERE status = 'new';
