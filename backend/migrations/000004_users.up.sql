-- Tài khoản người dùng.

-- citext: kiểu chữ không phân biệt hoa/thường. Email "Minh@Gmail.com" và "minh@gmail.com" là
-- một: UNIQUE trên citext chặn đăng ký trùng, so sánh = cũng không phân biệt hoa thường.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email             citext NOT NULL UNIQUE,
    -- Chuỗi argon2id dạng PHC: $argon2id$v=19$m=…,t=…,p=…$<muối>$<mã băm>.
    -- KHÔNG BAO GIỜ lưu mật khẩu gốc, kể cả mã hoá hai chiều.
    password_hash     text NOT NULL,
    display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 50),
    avatar_url        text,
    role              text NOT NULL DEFAULT 'user'
                      CHECK (role IN ('user', 'creator', 'business', 'editor', 'admin')),
    status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
    email_verified_at timestamptz,
    last_login_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
