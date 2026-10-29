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
