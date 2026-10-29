# Bài 0.04: Cấu hình bằng viper

> [← Bài trước](03-module-go-va-cau-truc.md) · [Mục lục](../README.md) · [Bài sau →](05-log-loi-phan-hoi.md)

## Mục tiêu

Gói `internal/config` đọc cấu hình từ `.env` và biến môi trường vào một struct `Config`.
Thiếu biến bắt buộc thì dừng ngay lúc khởi động và báo đúng tên biến.

## Bạn sẽ học

- Thứ tự ưu tiên: **biến môi trường > file `.env` > giá trị mặc định**.
- Bẫy lớn nhất của viper: `AutomaticEnv` **không** làm `Unmarshal` thấy biến môi trường của
  key mà viper chưa biết. Cách tránh: khai báo mọi key bằng `SetDefault`.
- Tag `mapstructure:",squash"` để chia struct theo nhóm mà key vẫn phẳng như tên biến môi trường.
- **Chết sớm**: thà không khởi động được còn hơn chạy được nửa chừng rồi lỗi lúc có khách.

## Viết code

### Bước 1: Cài viper

```bash
cd backend
go get github.com/spf13/viper@v1.21.0
```

viper là thư viện cấu hình phổ biến nhất của Go: đọc được file (.env, yaml, json…), biến môi
trường, giá trị mặc định, và tự đổi kiểu (`"10s"` → `time.Duration`, `"a,b"` → `[]string`).

### Bước 2: Ý tưởng

Dev: bạn đặt cấu hình trong `backend/.env` cho tiện. Production: Docker/server đặt biến môi
trường thật, không có file `.env`. Code phải chạy được cả hai cách mà không cần sửa.

Key viết **HOA_GẠCH_DƯỚI** giống hệt tên biến môi trường: `POSTGRES_URL`. Struct thì chia
nhóm cho dễ đọc: `cfg.Postgres.URL`. Tag `mapstructure:",squash"` nối hai thứ này: nó "trải
phẳng" các trường của nhóm `Postgres` lên cấp trên, nên viper tìm key `POSTGRES_URL` chứ không
phải `postgres.postgres_url`.

### Bước 3: `internal/config/config.go`

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
}

func (c Config) validate() error {
	var missing []string
	required := map[string]string{
		"POSTGRES_URL": c.Postgres.URL,
		"REDIS_ADDR":   c.Redis.Addr,
		"RABBITMQ_URL": c.RabbitMQ.URL,
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

	switch c.App.Env {
	case "development", "staging", "production":
	default:
		return fmt.Errorf("APP_ENV không hợp lệ: %q (chỉ nhận development, staging, production)", c.App.Env)
	}
	return nil
}
```

Điểm chính:

- **`v := viper.New()`** thay vì dùng viper toàn cục (`viper.SetDefault`…): không có trạng
  thái ẩn dùng chung, đọc code biết ngay config đến từ đâu.
- **`errors.Is(err, fs.ErrNotExist)`**: không có `.env` là bình thường (production), bỏ qua.
  Có `.env` mà sai cú pháp thì báo lỗi.
- **`SetDefault("POSTGRES_URL", "")`**: trông vô nghĩa nhưng bắt buộc. Viper chỉ tra biến môi
  trường cho key nó đã biết. Thiếu dòng này, ở production (không có `.env`) `cfg.Postgres.URL`
  luôn rỗng dù bạn đã đặt biến môi trường. Đây là lỗi kinh điển khi dùng viper.
- **`slices.Sort(missing)`**: duyệt `map` trong Go có thứ tự **ngẫu nhiên**, mỗi lần chạy
  một kiểu. Sắp xếp để thông báo lỗi luôn giống nhau.
- **Không log giá trị config**: `POSTGRES_URL` chứa mật khẩu.

Code nghiệp vụ **không** gọi `viper.Get...`. `Load()` chạy một lần trong `main`, sau đó `Config`
được truyền xuống qua tham số. Đọc chữ ký hàm là biết hàm đó dùng cấu hình nào.

### Bước 4: `backend/.env.example`

```dotenv
# Copy thành backend/.env: cp backend/.env.example backend/.env
# File được mount vào container api/worker cùng với code; viper đọc lúc khởi động.
# Sửa xong thì khởi động lại: make restart s=api (và s=worker).
#
# Địa chỉ PostgreSQL, Redis, RabbitMQ KHÔNG đặt ở đây: docker-compose.yml tự đặt
# (POSTGRES_URL, REDIS_ADDR, REDIS_PASSWORD, RABBITMQ_URL) cho khớp với mật khẩu
# trong file .env ở gốc repo. Biến môi trường luôn ghi đè giá trị trong file này.

APP_ENV=development
LOG_LEVEL=debug
# text: dễ đọc khi dev; json: production
LOG_FORMAT=text

HTTP_ADDR=:8080
HTTP_READ_TIMEOUT=10s
HTTP_WRITE_TIMEOUT=30s
HTTP_SHUTDOWN_TIMEOUT=15s
# Nhiều domain cách nhau bằng dấu phẩy
HTTP_CORS_ORIGINS=http://localhost:3000
HTTP_TRUSTED_PROXIES=127.0.0.1/32,::1/128

POSTGRES_MAX_CONNS=10
REDIS_DB=0
```

```bash
cp .env.example .env
```

`.env` đã nằm trong `.gitignore` (bài 0.01), `.env.example` thì commit.

Địa chỉ PostgreSQL, Redis, RabbitMQ không nằm trong file này: dự án chạy bằng Docker, và
`docker-compose.yml` (bài 0.10) đặt chúng bằng biến môi trường cho khớp với mật khẩu của các
service. Biến môi trường ưu tiên hơn `.env`, nên luôn thắng.

## Kiểm tra

Chưa có `main`, nên kiểm tra bằng build:

```bash
cd backend && go mod tidy && go build ./... && go vet ./...
```

Không in gì là đúng. Bài 0.09 có `main` và sẽ thử các thông báo lỗi config.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đặt biến môi trường rồi mà config vẫn rỗng | Key chưa có `SetDefault`. Thêm vào `setDefaults` |
| `HTTP_CORS_ORIGINS` chỉ ra một phần tử chứa cả dấu phẩy | Trường phải là `[]string`; viper tự tách theo dấu phẩy khi decode vào slice |
| `time: missing unit in duration` | Thời gian phải có đơn vị: `10s`, `5m`, không viết `10` |
| `.env` có dấu cách quanh `=` (`KEY = value`) | Viết liền: `KEY=value` |
