# Bài 4.09: Mailpit và hàng đợi job (thử lại, dead-letter)

> [← Bài trước](08-menu-tai-khoan-trang-ban.md) · [Mục lục](../README.md) · [Bài sau →](10-gui-mail-o-worker.md)

## Mục tiêu

- Mailpit: hộp thư giả khi dev, bắt mọi email, xem ở http://localhost:8025.
- `pkg/queue/jobs.go`: khai báo hàng đợi, gửi job có xác nhận, nhận job có thử lại và hàng "dead".

## Bạn sẽ học

- Vì sao gửi mail phải qua **hàng đợi**, không gửi ngay trong API.
- Mẫu "retry queue": TTL + dead-letter để thử lại sau một khoảng chờ.
- Publisher confirms, ack thủ công, prefetch.
- Kiểm tra một công cụ còn được bảo trì không trước khi dùng.

## Viết code

### Bước 1: MailHog hay Mailpit

Ý định ban đầu là MailHog. Kiểm tra trước khi dùng:

```bash
curl -s "https://hub.docker.com/v2/repositories/mailhog/mailhog/tags?page_size=3&ordering=last_updated" | grep -o '"last_updated":"[^"]*"'
# "2020-08-11…": bản cuối cùng từ năm 2020
```

MailHog không còn cập nhật 6 năm. **Mailpit** là bản thay thế đang phát triển (v1.32.0 ra ngày
22/10/2026), dùng cùng cổng SMTP 1025 và giao diện web 8025, nên code gửi mail giống hệt. Dự án ưu tiên
bản có vá lỗi (TASKS.md mục 1.4), nên dùng Mailpit.

### Bước 2: Thêm Mailpit vào `docker-compose.yml`

Bản đầy đủ:

```yaml
# Môi trường dev: mọi thứ chạy trong Docker.
#   make up      → chạy hết (hạ tầng + api + worker + frontend)
#                  web: http://localhost:3000   api: http://localhost:8080
#   make logs    → xem log
#   make down    → tắt
#
# api và worker chạy bằng air bên trong container, code mount từ ./backend vào:
# sửa file .go trên máy là container tự build và chạy lại.
#
# Mật khẩu, cổng: đọc từ file .env ở gốc repo (Compose tự đọc), không có thì dùng mặc định.
name: airlife

x-backend: &backend
  build:
    context: ./backend
    target: dev
  # Chạy bằng UID/GID của bạn để file sinh ra trong backend/tmp không thuộc root.
  user: "${UID:-1000}:${GID:-1000}"
  restart: unless-stopped
  volumes:
    - ./backend:/app
    - go-mod:/go/pkg/mod # thư viện Go đã tải, giữ lại giữa các lần chạy
    - go-cache:/go/cache # cache build, lần sau build nhanh hơn
  # backend/.env được mount vào /app/.env cùng với code, viper tự đọc lúc khởi động
  # (sửa xong: make restart s=api). Không dùng env_file: biến nạp kiểu đó chỉ cập nhật khi
  # tạo lại container, và lại đè lên giá trị mới trong file, rất dễ nhầm.
  #
  # Địa chỉ hạ tầng đặt ở đây (không đặt trong backend/.env) để luôn khớp với mật khẩu
  # của các service bên dưới. Trong mạng Docker, gọi nhau bằng tên service: postgres, redis…
  environment:
    POSTGRES_URL: postgres://${POSTGRES_USER:-airlife}:${POSTGRES_PASSWORD:-airlife}@postgres:5432/${POSTGRES_DB:-airlife}?sslmode=disable
    REDIS_ADDR: redis:6379
    REDIS_PASSWORD: ${REDIS_PASSWORD:-airlife}
    RABBITMQ_URL: amqp://${RABBITMQ_USER:-airlife}:${RABBITMQ_PASSWORD:-airlife}@rabbitmq:5672/
    # Dev: worker gửi mail vào Mailpit (bắt hết thư, xem ở http://localhost:8025), không gửi thật
    MAIL_SMTP_ADDR: mailpit:1025
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
    mailpit:
      condition: service_healthy

services:
  api:
    <<: *backend
    command: ["air", "-c", ".air.api.toml"]
    ports:
      - "127.0.0.1:${API_PORT:-8080}:8080"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 5s
      timeout: 3s
      retries: 30 # lần đầu air phải build, có thể mất gần một phút
      start_period: 10s

  worker:
    <<: *backend
    command: ["air", "-c", ".air.worker.toml"]

  frontend:
    build:
      context: ./frontend
      target: dev
    user: "${UID:-1000}:${GID:-1000}"
    restart: unless-stopped
    volumes:
      - ./frontend:/app
    environment:
      # Địa chỉ API mà TRÌNH DUYỆT gọi tới (nên là localhost của máy, không phải tên service)
      NEXT_PUBLIC_API_URL: http://localhost:${API_PORT:-8080}
      # Địa chỉ API mà SERVER Next.js (trong container này) gọi tới: tên service trong mạng Docker
      API_INTERNAL_URL: http://api:8080
      NEXT_PUBLIC_SITE_URL: http://localhost:${FRONTEND_PORT:-3000}
      npm_config_cache: /tmp/.npm # user theo UID có thể không có thư mục home
      npm_config_update_notifier: "false" # tắt thông báo "npm có bản mới" làm rối log
    ports:
      - "127.0.0.1:${FRONTEND_PORT:-3000}:3000"
    healthcheck:
      # 127.0.0.1, không dùng localhost: trong alpine localhost ra IPv6 (::1) trước,
      # mà next dev chỉ nghe IPv4 (0.0.0.0) → healthcheck báo lỗi dù trang vẫn chạy.
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/"]
      interval: 5s
      timeout: 5s
      retries: 60 # lần đầu npm install + biên dịch trang đầu tiên khá lâu
      start_period: 15s

  # Chạy migration: make migrate. profiles: ["tools"] để `docker compose up` không tự chạy nó.
  migrate:
    image: migrate/migrate:v4.20.1
    profiles: ["tools"]
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - ./backend/migrations:/migrations
    entrypoint:
      - migrate
      - -path=/migrations
      - -database=postgres://${POSTGRES_USER:-airlife}:${POSTGRES_PASSWORD:-airlife}@postgres:5432/${POSTGRES_DB:-airlife}?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy

  # Sinh code Go từ SQL: make sqlc. Image chính thức của sqlc (cần CGO, không chạy được bằng
  # `go run` trong image golang alpine).
  sqlc:
    image: sqlc/sqlc:1.31.1
    profiles: ["tools"]
    user: "${UID:-1000}:${GID:-1000}"
    working_dir: /src
    volumes:
      - ./backend:/src
    command: ["generate"]

  # Hộp thư giả cho dev: nhận MỌI email worker gửi qua SMTP (cổng 1025) và hiện trên giao diện
  # web, không gửi tới người nhận thật. Mailpit thay thế MailHog (MailHog ngừng phát triển từ 2020).
  mailpit:
    image: axllent/mailpit:v1.32.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:${MAILPIT_UI_PORT:-8025}:8025" # hộp thư: http://localhost:8025
    environment:
      MP_MAX_MESSAGES: 500 # giữ 500 thư gần nhất
    # Image có sẵn healthcheck (/mailpit readyz)

  postgres:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-airlife}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-airlife}
      POSTGRES_DB: ${POSTGRES_DB:-airlife}
    # 127.0.0.1: chỉ máy bạn kết nối được (cho DBeaver, TablePlus…), máy khác trong mạng LAN thì không.
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      # Postgres 18 lưu dữ liệu theo thư mục con có số phiên bản, nên mount vào /var/lib/postgresql
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8.10.3-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:-airlife}"]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:-airlife}
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD} --no-auth-warning ping | grep PONG"]
      interval: 5s
      timeout: 3s
      retries: 10

  rabbitmq:
    image: rabbitmq:4.4.0-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-airlife}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-airlife}
    ports:
      - "127.0.0.1:${RABBITMQ_UI_PORT:-15672}:15672" # trang quản trị: http://localhost:15672
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  postgres-data:
  redis-data:
  rabbitmq-data:
  go-mod:
  go-cache:
```

- **Chỉ mở cổng 8025** (giao diện) ra máy; cổng SMTP 1025 chỉ dùng trong mạng Docker (worker gọi `mailpit:1025`).
- **`MAIL_SMTP_ADDR: mailpit:1025`** trong khối `x-backend`: cùng chỗ với địa chỉ PostgreSQL, Redis.
- **`depends_on: mailpit: condition: service_healthy`**: image Mailpit có sẵn healthcheck
  (`docker image inspect axllent/mailpit:v1.32.0` thấy `"Test":["CMD","/mailpit","readyz"]`).

Cấu hình mail và địa chỉ trang web (để ghép link trong thư), `backend/internal/config/config.go`:

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
	Mail     Mail     `mapstructure:",squash"`
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

	v.SetDefault("MAIL_SMTP_ADDR", "") // chỉ worker cần; worker kiểm tra lúc khởi động
	v.SetDefault("MAIL_FROM", "Airlife <no-reply@airlife.local>")
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

Thêm vào `backend/.env.example` (và `backend/.env`):

```bash
# Địa chỉ trang web, dùng để ghép link trong email
APP_PUBLIC_URL=http://localhost:3000
# Email. MAIL_SMTP_ADDR do docker-compose.yml đặt (mailpit:1025 khi dev).
# Địa chỉ gửi: CHỜ KHÁCH chốt domain (TASKS.md); airlife.local chỉ để dev.
MAIL_FROM=Airlife <no-reply@airlife.local>
```

### Bước 3: Vì sao qua hàng đợi

Khách bấm "Đăng ký". Nếu API gửi mail ngay: chờ kết nối máy chủ mail (vài trăm ms tới vài giây), máy chủ
mail chập chờn thì đăng ký **lỗi** dù tài khoản đã tạo. Qua hàng đợi: API đẩy một job vào RabbitMQ (vài
ms) rồi trả lời ngay; worker gửi sau, lỗi thì tự thử lại.

### Bước 4: `backend/pkg/queue/jobs.go`

```go
package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Hàng đợi job, mỗi loại job có 3 queue:
//
//	<tên>        queue chính: API gửi job vào, worker lấy ra xử lý
//	<tên>.retry  xử lý lỗi → job vào đây, nằm chờ retryDelay rồi tự quay về queue chính
//	             (x-message-ttl + x-dead-letter: hết hạn thì RabbitMQ chuyển tiếp)
//	<tên>.dead   lỗi quá maxAttempts lần → nằm đây để người xem lại (trang quản trị RabbitMQ)
//
// Vì sao không thử lại ngay: lỗi thường do bên ngoài tạm hỏng (máy chủ mail chập chờn). Thử lại
// liền 5 lần trong 1 giây thì cả 5 lần đều hỏng; chờ 30 giây thì thường đã ổn.
//
// Gửi qua exchange mặc định (""): routing key chính là tên queue, không cần khai báo exchange riêng.

const (
	retryDelay  = 30 * time.Second
	maxAttempts = 5
	attemptHdr  = "x-attempt"
)

// DeclareJobQueue tạo 3 queue của một loại job. Gọi lại nhiều lần không sao (đã có thì giữ nguyên),
// nên cả API (bên gửi) và worker (bên nhận) đều gọi lúc khởi động, không phụ thuộc ai chạy trước.
func DeclareJobQueue(conn *amqp.Connection, name string) error {
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	defer func() { _ = ch.Close() }()

	// durable: queue còn sau khi RabbitMQ khởi động lại
	if _, err := ch.QueueDeclare(name+".dead", true, false, false, false, nil); err != nil {
		return fmt.Errorf("khai báo %s.dead: %w", name, err)
	}
	if _, err := ch.QueueDeclare(name+".retry", true, false, false, false, amqp.Table{
		"x-message-ttl":             retryDelay.Milliseconds(),
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": name,
	}); err != nil {
		return fmt.Errorf("khai báo %s.retry: %w", name, err)
	}
	if _, err := ch.QueueDeclare(name, true, false, false, false, amqp.Table{
		// Job bị từ chối (Nack, không requeue) → chuyển sang .dead
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": name + ".dead",
	}); err != nil {
		return fmt.Errorf("khai báo %s: %w", name, err)
	}
	return nil
}

// Publisher gửi job, CHỜ RabbitMQ xác nhận đã nhận (publisher confirms). Không chờ thì job có
// thể mất (RabbitMQ đang khởi động lại) mà API vẫn tưởng đã gửi xong.
type Publisher struct {
	mu sync.Mutex // một channel AMQP không nên gửi đồng thời từ nhiều goroutine
	ch *amqp.Channel
}

func NewPublisher(conn *amqp.Connection) (*Publisher, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, err
	}
	if err := ch.Confirm(false); err != nil {
		return nil, fmt.Errorf("bật publisher confirms: %w", err)
	}
	return &Publisher{ch: ch}, nil
}

func (p *Publisher) Publish(ctx context.Context, queueName string, job any) error {
	body, err := json.Marshal(job)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	confirm, err := p.ch.PublishWithDeferredConfirmWithContext(ctx, "", queueName, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent, // ghi xuống đĩa: còn sau khi RabbitMQ khởi động lại
		Timestamp:    time.Now(),
		Body:         body,
	})
	if err != nil {
		return err
	}
	ok, err := confirm.WaitContext(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("rabbitmq từ chối job")
	}
	return nil
}

// Handler xử lý một job. Trả lỗi = thử lại sau (tối đa maxAttempts lần).
type Handler func(ctx context.Context, body []byte) error

// Consume nhận job của một queue cho tới khi ctx bị huỷ.
func Consume(ctx context.Context, conn *amqp.Connection, queueName string, prefetch int, log *slog.Logger, h Handler) error {
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	defer func() { _ = ch.Close() }()
	// prefetch: RabbitMQ chỉ giao tối đa ngần này job chưa ack cho worker. Không đặt thì nó dồn
	// hết hàng nghìn job vào một worker, các worker khác (khi chạy nhiều bản) ngồi chơi.
	if err := ch.Qos(prefetch, 0, false); err != nil {
		return err
	}
	// autoAck = false: chỉ báo "xong" (Ack) SAU KHI xử lý thành công. Worker chết giữa chừng thì
	// job chưa ack quay lại queue, không mất.
	deliveries, err := ch.ConsumeWithContext(ctx, queueName, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	log.Info("đang nhận job", "queue", queueName)

	for d := range deliveries {
		attempt := attemptOf(d) + 1
		jobErr := h(ctx, d.Body)
		switch {
		case jobErr == nil:
			_ = d.Ack(false)
		case attempt < maxAttempts:
			log.Warn("job lỗi, thử lại sau", "queue", queueName, "attempt", attempt, "err", jobErr)
			if err := ch.PublishWithContext(ctx, "", queueName+".retry", false, false, amqp.Publishing{
				ContentType:  d.ContentType,
				DeliveryMode: amqp.Persistent,
				Headers:      amqp.Table{attemptHdr: attempt},
				Body:         d.Body,
			}); err != nil {
				_ = d.Nack(false, true) // gửi sang .retry hỏng: trả lại queue chính, thử ngay
				continue
			}
			_ = d.Ack(false)
		default:
			log.Error("job lỗi quá số lần thử, chuyển sang .dead", "queue", queueName, "attempt", attempt, "err", jobErr)
			_ = d.Nack(false, false) // không requeue → dead-letter sang .dead
		}
	}
	if ctx.Err() != nil {
		return nil // tắt worker bình thường
	}
	return errors.New("kênh nhận job bị đóng")
}

// attemptOf: số lần đã thử của job (header x-attempt, int32 như lúc ghi vào)
func attemptOf(d amqp.Delivery) int32 {
	if v, ok := d.Headers[attemptHdr].(int32); ok {
		return v
	}
	return 0
}
```

Đường đi của một job lỗi:

```text
email.send ──(worker xử lý lỗi, lần 1..4)──► email.send.retry ──(30 giây, TTL hết)──► email.send
           ──(lỗi lần 5)── Nack ──► (dead-letter) ──► email.send.dead
```

- **Publisher confirms**: `Publish` chờ RabbitMQ báo "đã nhận và lưu". Không chờ thì job có thể mất trong
  lúc RabbitMQ khởi động lại mà API không hề biết.
- **`DeliveryMode: amqp.Persistent`** + queue `durable`: job còn sau khi RabbitMQ khởi động lại.
- **Ack thủ công**: chỉ báo xong **sau khi** gửi được mail. Worker chết giữa chừng → job quay lại queue.
- **Header `x-attempt`** đếm số lần thử. Ghi và đọc cùng kiểu `int32`; bản đầu ghi `int32(attempt)` từ
  `int`, gosec báo G115 (có thể tràn số); sửa thành dùng `int32` từ đầu, không cần đổi kiểu.

## Kiểm tra

```bash
make up                         # có thêm container mailpit (healthy)
cd backend && go build ./... && cd .. && make lint
```

Mở http://localhost:8025: hộp thư Mailpit trống. Queue được tạo ở bài 4.10, 4.11 khi API, worker khởi động.

```bash
git add . && git commit -m "Mailpit, hàng đợi job có thử lại"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `PRECONDITION_FAILED - inequivalent arg 'x-dead-letter-exchange'` | Queue đã tồn tại với tham số khác (đổi code sau khi chạy). Xoá queue ở http://localhost:15672 (tab Queues) rồi khởi động lại |
| Job lỗi bị thử lại liên tục không nghỉ | Nack có `requeue=true` thay vì gửi sang `.retry` |
