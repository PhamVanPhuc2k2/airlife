-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id, email, display_name, avatar_url, role, email_verified_at, created_at;

-- Dùng khi đăng nhập: cần password_hash và status.
-- name: GetUserForLogin :one
SELECT id, email, password_hash, display_name, role, status
FROM users
WHERE email = $1;

-- Thông tin công khai của tài khoản (không có password_hash).
-- name: GetUserByID :one
SELECT id, email, display_name, avatar_url, role, status, email_verified_at, created_at
FROM users
WHERE id = $1;

-- name: TouchLastLogin :exec
UPDATE users SET last_login_at = now() WHERE id = $1;

-- Chỉ đặt khi chưa xác minh: bấm lại link cũ không làm đổi thời điểm xác minh.
-- name: SetEmailVerified :exec
UPDATE users SET email_verified_at = now(), updated_at = now()
WHERE id = $1 AND email_verified_at IS NULL;

-- name: UpdatePassword :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;
