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

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/turnstile"
)

type Config struct {
	App      App      `mapstructure:",squash"`
	Log      Log      `mapstructure:",squash"`
	HTTP     HTTP     `mapstructure:",squash"`
	Postgres Postgres `mapstructure:",squash"`
	Redis    Redis    `mapstructure:",squash"`
	RabbitMQ RabbitMQ `mapstructure:",squash"`
	Auth     Auth     `mapstructure:",squash"`
	Mail     Mail     `mapstructure:",squash"`
	Payment  Payment  `mapstructure:",squash"`
	Weather  Weather  `mapstructure:",squash"`
	Captcha  Captcha  `mapstructure:",squash"`
}

type App struct {
	Env string `mapstructure:"APP_ENV"` // development | staging | production
	// Địa chỉ trang web (frontend) để ghép link trong email: <PublicURL>/xac-minh-email?token=…
	PublicURL string `mapstructure:"APP_PUBLIC_URL"`
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

// Mail: worker gửi email. Dev gửi qua SMTP vào Mailpit; production dùng Resend (thêm sau).
type Mail struct {
	SMTPAddr string `mapstructure:"MAIL_SMTP_ADDR"` // host:port, vd. mailpit:1025
	From     string `mapstructure:"MAIL_FROM"`
}

// Weather: nguồn thời tiết sân bay (Phần 10).
type Weather struct {
	// Mặc định Open-Meteo miễn phí, không cần khoá API. Đổi sang bản trả phí khi chạy kinh doanh.
	BaseURL string `mapstructure:"WEATHER_BASE_URL"`
}

// Captcha: Cloudflare Turnstile cho các form công khai (Phần 11).
type Captcha struct {
	// Khoá bí mật. Dev dùng khoá thử công khai của Cloudflare (luôn cho qua); production phải là
	// khoá thật tạo ở dash.cloudflare.com → Turnstile, đặt bằng biến môi trường.
	TurnstileSecret string `mapstructure:"TURNSTILE_SECRET"`
	// Địa chỉ siteverify; chỉ đổi khi muốn thử tình huống lỗi.
	TurnstileVerifyURL string `mapstructure:"TURNSTILE_VERIFY_URL"`
}

// Payment: cổng thanh toán online (Phần 09).
type Payment struct {
	// fake: cổng giả lập, chỉ dev. Cổng thật (vnpay, momo, zalopay) thêm khi có tài khoản.
	Provider string `mapstructure:"PAYMENT_PROVIDER"`
	// Khoá ký webhook, chung giữa ta và cổng. Lộ khoá = ai cũng tự "báo đã trả tiền" được.
	// Production: chuỗi ngẫu nhiên ≥ 32 ký tự, đặt bằng biến môi trường, không commit.
	WebhookSecret string `mapstructure:"PAYMENT_WEBHOOK_SECRET"`
	// Địa chỉ webhook của API mà cổng GIẢ LẬP gọi tới (cổng thật dùng địa chỉ cấu hình ở trang
	// quản trị của họ). Trong Docker, API gọi chính nó qua localhost.
	NotifyURL string `mapstructure:"PAYMENT_NOTIFY_URL"`
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
	v.SetDefault("APP_PUBLIC_URL", "http://localhost:3000")
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

	v.SetDefault("WEATHER_BASE_URL", "https://api.open-meteo.com")
	v.SetDefault("TURNSTILE_SECRET", turnstile.TestSecretPass)
	v.SetDefault("TURNSTILE_VERIFY_URL", turnstile.DefaultVerifyURL)
	v.SetDefault("PAYMENT_PROVIDER", "fake")
	v.SetDefault("PAYMENT_WEBHOOK_SECRET", "") // bắt buộc, ≥ 32 ký tự
	v.SetDefault("PAYMENT_NOTIFY_URL", "http://localhost:8080/api/v1/webhooks/payment/fake")

	v.SetDefault("MAIL_SMTP_ADDR", "") // chỉ worker cần; worker kiểm tra lúc khởi động
	v.SetDefault("MAIL_FROM", "Airlife <no-reply@airlife.local>")
}

func (c Config) validate() error {
	var missing []string
	required := map[string]string{
		"POSTGRES_URL":           c.Postgres.URL,
		"REDIS_ADDR":             c.Redis.Addr,
		"RABBITMQ_URL":           c.RabbitMQ.URL,
		"AUTH_JWT_SECRET":        c.Auth.JWTSecret,
		"PAYMENT_WEBHOOK_SECRET": c.Payment.WebhookSecret,
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

	// Khoá thử của Cloudflare cho mọi token qua: ở production thì form nào cũng bị bot spam tự do
	if c.IsProduction() && (c.Captcha.TurnstileSecret == "" || strings.HasPrefix(c.Captcha.TurnstileSecret, "1x0000")) {
		return errors.New("TURNSTILE_SECRET production phải là khoá thật, không dùng khoá thử của Cloudflare")
	}

	if len(c.Payment.WebhookSecret) < 32 {
		return errors.New("PAYMENT_WEBHOOK_SECRET phải dài ít nhất 32 ký tự")
	}
	switch c.Payment.Provider {
	case "fake":
		// Cổng giả lập tự báo "đã trả tiền" cho bất kỳ ai gọi: tuyệt đối không chạy trên production
		if c.IsProduction() {
			return errors.New("PAYMENT_PROVIDER=fake không được dùng ở production")
		}
	default:
		return fmt.Errorf("PAYMENT_PROVIDER không hợp lệ: %q (hiện chỉ có fake)", c.Payment.Provider)
	}

	switch c.App.Env {
	case "development", "staging", "production":
	default:
		return fmt.Errorf("APP_ENV không hợp lệ: %q (chỉ nhận development, staging, production)", c.App.Env)
	}
	return nil
}
