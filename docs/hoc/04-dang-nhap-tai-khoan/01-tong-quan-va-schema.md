# Bài 4.01: Tổng quan đăng nhập, cấu hình và bảng `users`

> [← Phần 03](../03-tin-tuc-va-line-up/07-trang-moi-tai-line-up.md) · [Mục lục](../README.md) · [Bài sau →](02-bam-mat-khau.md)

## Mục tiêu

Hiểu toàn bộ thiết kế đăng nhập trước khi gõ code; thêm cấu hình `AUTH_*` và bảng `users`.

## Bạn sẽ học

- Mô hình **hai token**: access token ngắn hạn + refresh token dài hạn xoay vòng.
- Vì sao token nằm trong **cookie HttpOnly**, không nằm trong `localStorage`.
- Các lớp phòng thủ: băm mật khẩu, chặn dò mật khẩu, chống CSRF, phát hiện token bị đánh cắp.
- Kiểu `citext` cho email.

## Viết code

### Bước 1: Vì sao Phần 04 là Đăng nhập (không phải Kênh)

TASKS.md xếp "Kênh và bình luận" trước "Đăng nhập". Nhưng theo dõi kênh, viết bình luận, trang Bạn,
Sưu tập đều cần biết **ai đang dùng**. Làm Kênh trước thì phải làm tạm rồi quay lại sửa; nên đổi thứ tự.

### Bước 2: Bức tranh tổng thể

```text
Đăng nhập ──► API kiểm tra mật khẩu (argon2id) ──► đặt 3 cookie:
   al_access  (JWT, 15 phút, HttpOnly, Path=/)               ← gửi kèm MỌI request tới API
   al_refresh (ngẫu nhiên, 30 ngày, HttpOnly, Path=/api/v1/auth)  ← chỉ gửi khi làm mới/đăng xuất
   al_session ("1", 30 ngày, KHÔNG HttpOnly)                 ← dấu hiệu "có phiên" cho frontend

Gọi API ──► middleware đọc al_access, kiểm tra chữ ký JWT ──► biết ai đang gọi (không hỏi DB)
Sau 15 phút ──► API trả 401 token_expired ──► frontend gọi /auth/refresh ──► cặp token mới ──► thử lại
```

| Câu hỏi | Trả lời |
|---|---|
| Vì sao không chỉ một token sống 30 ngày? | JWT không thu hồi được (API chỉ kiểm tra chữ ký). Lộ token sống 30 ngày = kẻ gian dùng 30 ngày. Access token chỉ sống 15 phút; refresh token nằm trong Redis nên thu hồi được ngay |
| Vì sao cookie HttpOnly, không phải `localStorage`? | JavaScript **không đọc được** cookie HttpOnly. Nếu trang dính lỗi XSS (bài 3.01), mã độc đọc được `localStorage` nhưng không lấy được token trong cookie |
| Cookie tự gửi kèm thì có bị CSRF không? | Có nguy cơ. Chặn bằng hai lớp: `SameSite=Lax` và kiểm tra header `Origin` (bài 4.05) |
| Refresh token bị đánh cắp thì sao? | Xoay vòng: mỗi lần dùng là đổi token mới. Token cũ bị dùng lại = có hai người giữ → thu hồi cả phiên (bài 4.03) |

### Bước 3: Cấu hình

Thêm nhóm `Auth` vào `backend/internal/config/config.go`. Bản đầy đủ:

```go
// Package config đọc cấu hình của api và worker bằng viper.
//
// Nguồn cấu hình, ưu tiên từ cao xuống thấp:
//  1. Biến môi trường thật (Docker, server production)
//  2. File .env trong thư mục backend/ (chỉ dùng khi dev, không có cũng được)
//  3. Giá trị mặc định trong setDefaults
//
// Mọi key đều viết HOA_GẠCH_DƯỚI giống tên biến môi trường. Các nhóm (App, HTTP…)
// dùng tag `mapstructure:",squash"` để trải phẳng, nhờ vậy key trong .env và key
// biến môi trường là một, không cần đổi "postgres.url" ↔ "POSTGRES_URL".
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"slices"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	App      App      `mapstructure:",squash"`
	Log      Log      `mapstructure:",squash"`
	HTTP     HTTP     `mapstructure:",squash"`
	Postgres Postgres `mapstructure:",squash"`
	Redis    Redis    `mapstructure:",squash"`
	RabbitMQ RabbitMQ `mapstructure:",squash"`
	Auth     Auth     `mapstructure:",squash"`
}

type App struct {
	Env string `mapstructure:"APP_ENV"` // development | staging | production
}

type Log struct {
	Level  string `mapstructure:"LOG_LEVEL"`  // debug | info | warn | error
	Format string `mapstructure:"LOG_FORMAT"` // text (dễ đọc khi dev) | json (production)
}

type HTTP struct {
	Addr            string        `mapstructure:"HTTP_ADDR"`
	ReadTimeout     time.Duration `mapstructure:"HTTP_READ_TIMEOUT"`
	WriteTimeout    time.Duration `mapstructure:"HTTP_WRITE_TIMEOUT"`
	ShutdownTimeout time.Duration `mapstructure:"HTTP_SHUTDOWN_TIMEOUT"`
	// Domain frontend được gọi API từ trình duyệt, cách nhau bằng dấu phẩy.
	CORSOrigins []string `mapstructure:"HTTP_CORS_ORIGINS"`
	// Dải IP của proxy đứng trước API (nginx, Cloudflare). Chỉ request đến từ các
	// IP này mới được tin header CF-Connecting-IP / X-Real-IP.
	TrustedProxies []string `mapstructure:"HTTP_TRUSTED_PROXIES"`
}

type Postgres struct {
	URL      string `mapstructure:"POSTGRES_URL"`
	MaxConns int32  `mapstructure:"POSTGRES_MAX_CONNS"`
}

type Redis struct {
	Addr     string `mapstructure:"REDIS_ADDR"`
	Password string `mapstructure:"REDIS_PASSWORD"`
	DB       int    `mapstructure:"REDIS_DB"`
}

type RabbitMQ struct {
	URL string `mapstructure:"RABBITMQ_URL"`
}

type Auth struct {
	// Khoá ký access token (JWT HS256). Lộ khoá này = ai cũng tự tạo được token đăng nhập
	// thành bất kỳ ai. Production: chuỗi ngẫu nhiên ≥ 32 ký tự (openssl rand -base64 48),
	// đặt bằng biến môi trường, không commit.
	JWTSecret  string        `mapstructure:"AUTH_JWT_SECRET"`
	AccessTTL  time.Duration `mapstructure:"AUTH_ACCESS_TTL"`
	RefreshTTL time.Duration `mapstructure:"AUTH_REFRESH_TTL"`
	// Domain của cookie đăng nhập. Rỗng = chỉ host hiện tại (dev: localhost).
	// Production: ".airlife.vn" để cả airlife.vn và api.airlife.vn cùng thấy cookie.
	CookieDomain string `mapstructure:"AUTH_COOKIE_DOMAIN"`
}

func (c Config) IsProduction() bool { return c.App.Env == "production" }

// Load đọc cấu hình. Thiếu biến bắt buộc thì trả lỗi để main dừng ngay lúc khởi động,
// thay vì chạy được nửa chừng rồi mới lỗi khi có request đầu tiên.
func Load() (Config, error) {
	v := viper.New()
	setDefaults(v)

	v.SetConfigFile(".env")
	v.SetConfigType("env")
	if err := v.ReadInConfig(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Config{}, fmt.Errorf("đọc .env: %w", err)
	}

	// AutomaticEnv chỉ tra biến môi trường cho những key viper đã biết (có default
	// hoặc có trong .env). Vì vậy MỌI key đều phải khai báo trong setDefaults,
	// kể cả key bắt buộc (default rỗng), nếu không Unmarshal sẽ bỏ qua nó.
	v.AutomaticEnv()

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return Config{}, fmt.Errorf("giải mã cấu hình: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("LOG_LEVEL", "info")
	v.SetDefault("LOG_FORMAT", "text")

	v.SetDefault("HTTP_ADDR", ":8080")
	v.SetDefault("HTTP_READ_TIMEOUT", "10s")
	v.SetDefault("HTTP_WRITE_TIMEOUT", "30s")
	v.SetDefault("HTTP_SHUTDOWN_TIMEOUT", "15s")
	v.SetDefault("HTTP_CORS_ORIGINS", "http://localhost:3000")
	v.SetDefault("HTTP_TRUSTED_PROXIES", "127.0.0.1/32,::1/128")

	v.SetDefault("POSTGRES_URL", "") // bắt buộc
	v.SetDefault("POSTGRES_MAX_CONNS", 10)

	v.SetDefault("REDIS_ADDR", "") // bắt buộc
	v.SetDefault("REDIS_PASSWORD", "")
	v.SetDefault("REDIS_DB", 0)

	v.SetDefault("RABBITMQ_URL", "") // bắt buộc

	v.SetDefault("AUTH_JWT_SECRET", "") // bắt buộc, ≥ 32 ký tự
	v.SetDefault("AUTH_ACCESS_TTL", "15m")
	v.SetDefault("AUTH_REFRESH_TTL", "720h") // 30 ngày
	v.SetDefault("AUTH_COOKIE_DOMAIN", "")
}

func (c Config) validate() error {
	var missing []string
	required := map[string]string{
		"POSTGRES_URL":    c.Postgres.URL,
		"REDIS_ADDR":      c.Redis.Addr,
		"RABBITMQ_URL":    c.RabbitMQ.URL,
		"AUTH_JWT_SECRET": c.Auth.JWTSecret,
	}
	for key, val := range required {
		if strings.TrimSpace(val) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing) // map duyệt ngẫu nhiên; sắp xếp để thông báo lỗi luôn giống nhau
		return fmt.Errorf("thiếu biến môi trường bắt buộc: %s", strings.Join(missing, ", "))
	}

	if len(c.Auth.JWTSecret) < 32 {
		return errors.New("AUTH_JWT_SECRET phải dài ít nhất 32 ký tự")
	}

	switch c.App.Env {
	case "development", "staging", "production":
	default:
		return fmt.Errorf("APP_ENV không hợp lệ: %q (chỉ nhận development, staging, production)", c.App.Env)
	}
	return nil
}
```

- **`AUTH_JWT_SECRET` bắt buộc, ≥ 32 ký tự**: khoá ngắn thì dò ra được bằng máy. Thiếu hoặc ngắn là API
  **không khởi động** (chết sớm, bài 0.04).
- **`AUTH_COOKIE_DOMAIN`**: dev để trống. Production `.airlife.vn`: cookie do `api.airlife.vn` đặt cũng
  được gửi tới `airlife.vn` (server Next.js cần nó).

Thêm vào cuối `backend/.env.example` (và chép sang `backend/.env`):

```bash
# Đăng nhập. Khoá dưới đây CHỈ dùng khi dev; production tạo khoá riêng: openssl rand -base64 48
AUTH_JWT_SECRET=dev-only-khong-dung-cho-production-0123456789abcdef
AUTH_ACCESS_TTL=15m
AUTH_REFRESH_TTL=720h
AUTH_COOKIE_DOMAIN=
```

### Bước 4: `backend/migrations/000004_users.up.sql`

```bash
make migrate-new name=users
```

```sql
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
```

- **`citext`**: `Minh@Gmail.com` và `minh@gmail.com` là cùng một email. `UNIQUE` trên `citext` chặn đăng
  ký trùng dù khác hoa thường, và `WHERE email = $1` cũng không phân biệt.
- **`status`**: khoá tài khoản mà không xoá (giữ bình luận, đơn hàng).
- **`email_verified_at`**: thời điểm xác minh (lượt sau làm); NULL = chưa xác minh.

#### `backend/migrations/000004_users.down.sql`

```sql
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS citext;
```

### Bước 5: `backend/internal/db/queries/users.sql`

```sql
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
```

Hai truy vấn đọc tách bạch: `GetUserForLogin` có `password_hash` (chỉ dùng lúc đăng nhập),
`GetUserByID` không có. Mã băm mật khẩu không bao giờ đi xa hơn chỗ cần nó.

## Kiểm tra

```bash
make migrate && make migrate-down && make migrate     # 4/u users  4/d users  4/u users
make sqlc
grep -n "Email " backend/internal/db/users.sql.go | head -1     # Email string  ← citext thành string
make restart s=api && make logs s=api     # api đang chạy (đã có AUTH_JWT_SECRET)
git add . && git commit -m "Cấu hình đăng nhập, bảng users"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| API không khởi động: `thiếu biến môi trường bắt buộc: AUTH_JWT_SECRET` | Thêm vào `backend/.env`, `make restart s=api` |
| `AUTH_JWT_SECRET phải dài ít nhất 32 ký tự` | Khoá quá ngắn |
| `type "citext" does not exist` | Thiếu `CREATE EXTENSION citext` trước `CREATE TABLE` |
