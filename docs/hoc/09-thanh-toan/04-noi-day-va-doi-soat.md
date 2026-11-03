# Bài 9.04: Endpoint webhook, cấu hình, worker đối soát

> [← Bài trước](03-xu-ly-thanh-toan.md) · [Mục lục](../README.md) · [Bài sau →](05-thu-api.md)

## Mục tiêu

- `POST /webhooks/payment/{provider}` nhận webhook; `POST /me/bookings/{code}/pay` bắt đầu thanh toán;
  route của trang cổng giả lập (chỉ dev).
- Cấu hình `PAYMENT_*`; production không được dùng cổng giả lập.
- Worker đối soát 2 phút một lần.
- Đơn đặt chỗ trả thêm thông tin khoản thanh toán.

## Bạn sẽ học

- Mã HTTP trả về cho cổng quyết định cổng có gửi lại hay không.
- Đọc nguyên văn body để kiểm tra chữ ký, giới hạn kích thước.
- Cấu hình bắt buộc và chặn cấu hình nguy hiểm lúc khởi động.
- Thứ tự dựng đối tượng để không rò context (govet `lostcancel`).

## Viết code

### Bước 1: Handler, `backend/internal/payment/handler.go`

```go
package payment

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Webhook không dài: nội dung vài trăm byte. Giới hạn để không ai đẩy cả gigabyte vào bộ nhớ.
const maxWebhookBody = 64 << 10

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// POST /me/bookings/{code}/pay → {"payment_url": "…"}: chuyển trình duyệt của khách tới đó.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.ActorFrom(r.Context())
	url, err := h.svc.Start(r.Context(), a.UserID, chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, map[string]string{"payment_url": url})
}

// POST /webhooks/payment/{provider}: CỔNG gọi vào đây (không phải trình duyệt, không có cookie).
// Xác thực bằng chữ ký HMAC trong header, không bằng đăng nhập.
//
// Mã trả về quyết định cổng có gửi lại hay không:
//   - 2xx: đã nhận (kể cả sự kiện trùng): cổng dừng gửi.
//   - 400: chữ ký sai / nội dung hỏng: gửi lại cũng vô ích, và có thể là kẻ giả mạo.
//   - 5xx: lỗi của ta (database tạm hỏng): cổng gửi lại sau.
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	if chi.URLParam(r, "provider") != h.svc.Provider() {
		response.Error(w, r, h.log, apperr.NotFound("unknown_provider", "Không có cổng thanh toán này"))
		return
	}
	// Đọc NGUYÊN VĂN body: chữ ký tính trên đúng các byte cổng gửi. Giải mã rồi mã hoá lại JSON
	// có thể đổi thứ tự khoá, khoảng trắng và làm chữ ký sai.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		response.Error(w, r, h.log, apperr.Invalid("invalid_body", "Không đọc được nội dung"))
		return
	}
	err = h.svc.HandleWebhook(r.Context(), r.Header, body)
	switch {
	case errors.Is(err, payment.ErrBadSignature):
		h.log.WarnContext(r.Context(), "webhook thanh toán sai chữ ký", "ip", r.RemoteAddr)
		response.Error(w, r, h.log, apperr.Invalid("bad_signature", "Chữ ký không hợp lệ"))
	case errors.Is(err, payment.ErrBadPayload):
		response.Error(w, r, h.log, apperr.Invalid("bad_payload", "Nội dung không hợp lệ"))
	case err != nil:
		response.Error(w, r, h.log, err)
	default:
		response.NoContent(w)
	}
}

// --- Trang của cổng GIẢ LẬP (chỉ dev) ---------------------------------------------------------

type FakeHandler struct {
	gw  *payment.Fake
	log *slog.Logger
}

func NewFakeHandler(gw *payment.Fake, log *slog.Logger) *FakeHandler {
	return &FakeHandler{gw: gw, log: log}
}

// GET /dev/fake-gateway/{txn}: thông tin phiên để trang cổng giả lập hiện ra
func (h *FakeHandler) Session(w http.ResponseWriter, r *http.Request) {
	s, err := h.gw.Session(r.Context(), chi.URLParam(r, "txn"))
	if errors.Is(err, payment.ErrNoSession) {
		response.Error(w, r, h.log, apperr.NotFound("session_not_found", "Không có phiên thanh toán này"))
		return
	}
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, s)
}

// POST /dev/fake-gateway/{txn}  {"result": "succeeded" | "failed"}: khách bấm nút ở trang cổng
func (h *FakeHandler) Complete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Result payment.Status `json:"result"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	returnURL, err := h.gw.Complete(r.Context(), chi.URLParam(r, "txn"), in.Result)
	if errors.Is(err, payment.ErrNoSession) {
		response.Error(w, r, h.log, apperr.NotFound("session_not_found", "Không có phiên thanh toán này"))
		return
	}
	// Webhook lỗi vẫn đưa khách về: đúng như cổng thật (trình duyệt và webhook là hai đường riêng)
	if err != nil {
		h.log.ErrorContext(r.Context(), "cổng giả lập: gọi webhook lỗi", "err", err)
	}
	response.OK(w, map[string]string{"return_url": returnURL})
}
```

- **Mã trả về**: `2xx` = đã nhận (kể cả sự kiện trùng) → cổng dừng gửi. `400` = chữ ký sai/nội dung hỏng →
  gửi lại vô ích, và đáng ghi log vì có thể là kẻ giả mạo. `5xx` = lỗi của ta (database tạm hỏng) → cổng
  gửi lại sau.
- **`MaxBytesReader`**: webhook vài trăm byte; không để ai đẩy cả gigabyte vào bộ nhớ.
- **Webhook không cần `Origin`**: middleware chống CSRF (`sameOrigin`, bài 4.05) chỉ từ chối khi **có**
  header `Origin` sai; cổng gọi từ server nên không có `Origin`, đi qua. Webhook xác thực bằng chữ ký,
  không bằng cookie.
- **`FakeHandler`**: hai route cho trang cổng giả lập (xem phiên, bấm "thành công"/"thất bại").

### Bước 2: Cấu hình, `backend/internal/config/config.go`

Thêm nhóm `Payment` (`PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_NOTIFY_URL`) vào `Config`,
`setDefaults` và `validate`. Bản đầy đủ:

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
	Payment  Payment  `mapstructure:",squash"`
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
```

- **`PAYMENT_WEBHOOK_SECRET` bắt buộc, ≥ 32 ký tự** (như `AUTH_JWT_SECRET`).
- **`PAYMENT_PROVIDER=fake` ở production là lỗi lúc khởi động**: cổng giả lập tự báo "đã trả tiền" cho bất
  kỳ ai bấm nút. Cấu hình sai thì API không chạy, thay vì chạy và bán vé miễn phí.

Thêm vào cuối `backend/.env` và `backend/.env.example`:

```bash
# Thanh toán online. fake = cổng giả lập (chỉ dev). Khoá ký webhook: production đặt chuỗi ngẫu nhiên
# riêng (openssl rand -base64 48), không dùng giá trị dưới đây.
PAYMENT_PROVIDER=fake
PAYMENT_WEBHOOK_SECRET=dev-only-khoa-webhook-thanh-toan-0123456789abcdef
PAYMENT_NOTIFY_URL=http://localhost:8080/api/v1/webhooks/payment/fake
```

### Bước 3: Nối route, `backend/internal/server/server.go`

Bản đầy đủ:

```go
// Package server dựng router go-chi: middleware dùng chung, health check và các nhóm API.
//
// Mỗi module nghiệp vụ (media, product…) sẽ có handler riêng và được gắn vào
// nhóm /api/v1 trong Handler(). File này lớn dần qua các phần của khoá học.
package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/booking"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/cart"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/category"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/channel"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/home"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/library"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/news"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/order"
	paymentsvc "github.com/PhamVanPhuc2k2/airlife/backend/internal/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/product"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	paypkg "github.com/PhamVanPhuc2k2/airlife/backend/pkg/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Deps gom các kết nối hạ tầng mà handler cần. cmd/api tạo một lần rồi truyền vào.
type Deps struct {
	Config   config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Redis    *redis.Client
	RabbitMQ *amqp.Connection
}

type Server struct {
	deps Deps
}

func New(deps Deps) *Server {
	return &Server{deps: deps}
}

// Handler trả http.Handler đã gắn đủ middleware và route.
func (s *Server) Handler() (http.Handler, error) {
	trusted, err := parsePrefixes(s.deps.Config.HTTP.TrustedProxies)
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()

	// Thứ tự middleware có ý nghĩa: realIP và RequestID phải chạy trước logger
	// để dòng log có IP và request_id; recoverer bọc mọi thứ phía sau.
	r.Use(realIP(trusted))
	r.Use(middleware.RequestID)
	r.Use(requestLogger(s.deps.Log))
	r.Use(recoverer(s.deps.Log))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: s.deps.Config.HTTP.CORSOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		// Idempotency-Key: chống đặt hàng trùng (Phần 07). Header lạ phải khai báo ở đây, không thì
		// trình duyệt chặn request ngay ở bước preflight (OPTIONS).
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language", "Idempotency-Key"},
		AllowCredentials: true, // cần để trình duyệt gửi cookie refresh token
		MaxAge:           300,
	}))
	// Huỷ context của request quá lâu (truy vấn DB treo…) và trả 504.
	// http.Server ở cmd/api đặt WriteTimeout dài hơn mức này một chút để kịp gửi 504.
	r.Use(middleware.Timeout(s.deps.Config.HTTP.WriteTimeout))
	r.Use(sameOrigin(s.deps.Config.HTTP.CORSOrigins))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.NotFound("route_not_found", "Không tìm thấy đường dẫn"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.Invalid("method_not_allowed", "Phương thức không được hỗ trợ"))
	})

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	// Nối dây các module: repository/service/handler tạo một lần ở đây.
	q := db.New(s.deps.DB)
	clientIP := func(r *http.Request) string { return ClientIP(r.Context()) }

	categorySvc := category.NewService(q, s.deps.Redis)
	categoryH := category.NewHandler(categorySvc, s.deps.Log)

	mediaSvc := media.NewService(media.NewRepository(q), s.deps.Redis)
	mediaH := media.NewHandler(mediaSvc, s.deps.Log, clientIP)

	channelH := channel.NewHandler(channel.NewService(s.deps.DB), s.deps.Log)
	commentSvc := comment.NewService(s.deps.DB, s.deps.Redis)
	commentH := comment.NewHandler(commentSvc, s.deps.Log)
	libraryH := library.NewHandler(library.NewService(s.deps.DB), s.deps.Log)
	productSvc := product.NewService(q)
	productH := product.NewHandler(productSvc, s.deps.Log)
	cartH := cart.NewHandler(cart.NewService(q), s.deps.Log)
	bookingH := booking.NewHandler(booking.NewService(s.deps.DB), s.deps.Log)
	homeH := home.NewHandler(home.NewService(mediaSvc, commentSvc, productSvc, s.deps.Redis), s.deps.Log)

	authCfg := s.deps.Config.Auth
	tokens := auth.NewTokenIssuer(authCfg.JWTSecret, authCfg.AccessTTL)
	// Hàng đợi gửi mail: khai báo queue (đã có thì thôi) và mở publisher
	if err := queue.DeclareJobQueue(s.deps.RabbitMQ, mail.Queue); err != nil {
		return nil, err
	}
	publisher, err := queue.NewPublisher(s.deps.RabbitMQ)
	if err != nil {
		return nil, err
	}
	authSvc, err := auth.NewService(q, s.deps.Redis, tokens, auth.NewSessions(s.deps.Redis, authCfg.RefreshTTL),
		publisher, s.deps.Config.App.PublicURL)
	if err != nil {
		return nil, err
	}
	authH := auth.NewHandler(authSvc, s.deps.Log, auth.CookieConfig{
		Domain:     authCfg.CookieDomain,
		Secure:     s.deps.Config.App.Env != "development", // dev chạy http://localhost
		AccessTTL:  authCfg.AccessTTL,
		RefreshTTL: authCfg.RefreshTTL,
	}, clientIP)
	requireAuth := auth.RequireAuth(s.deps.Log)
	payCfg := s.deps.Config.Payment
	fakeGW := paypkg.NewFake(s.deps.Redis, payCfg.WebhookSecret, s.deps.Config.App.PublicURL, payCfg.NotifyURL)
	paymentH := paymentsvc.NewHandler(paymentsvc.NewService(s.deps.DB, fakeGW, publisher,
		s.deps.Config.App.PublicURL, s.deps.Log), s.deps.Log)
	orderH := order.NewHandler(order.NewService(s.deps.DB, s.deps.Redis, publisher,
		s.deps.Config.App.PublicURL, s.deps.Log), s.deps.Log)
	newsH := news.NewHandler(news.NewService(q, s.deps.Redis), s.deps.Log)

	r.Route("/api/v1", func(r chi.Router) {
		// Mọi API đều biết ai đang gọi (nếu có đăng nhập); API nào bắt buộc đăng nhập thì thêm
		// requireAuth.
		r.Use(auth.Authenticate(tokens))

		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			response.OK(w, map[string]string{"message": "pong"})
		})

		r.Get("/home", homeH.Get)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", authH.Register)
			r.Post("/login", authH.Login)
			r.Post("/refresh", authH.Refresh)
			r.Post("/logout", authH.Logout)
			r.With(requireAuth).Get("/me", authH.Me)
			r.Post("/verify-email", authH.VerifyEmail)
			r.With(requireAuth).Post("/verify-email/resend", authH.ResendVerifyEmail)
			r.Post("/forgot-password", authH.ForgotPassword)
			r.Post("/reset-password", authH.ResetPassword)
		})

		r.Get("/categories", categoryH.List)
		r.Get("/categories/{slug}", categoryH.Get)

		r.Get("/media", mediaH.List)
		r.Get("/media/{slug}", mediaH.Get)
		r.Get("/media/{slug}/related", mediaH.Related)
		r.Post("/media/{slug}/views", mediaH.RecordView)
		r.Get("/lineup/months", mediaH.LineupMonths)

		r.Get("/channels/{slug}", channelH.Get)
		r.With(requireAuth).Post("/channels/{slug}/follow", channelH.Follow)
		r.With(requireAuth).Delete("/channels/{slug}/follow", channelH.Unfollow)

		// Bán hàng (Phần 07)
		r.Get("/products", productH.List)
		r.Get("/products/{slug}", productH.Get)
		r.Get("/media/{slug}/products", productH.ByMedia)
		r.Post("/cart/preview", cartH.Preview) // giỏ của khách chưa đăng nhập
		r.Get("/products/{slug}/departures", bookingH.Availability)

		// Cổng thanh toán gọi vào đây (không đăng nhập; xác thực bằng chữ ký HMAC)
		r.Post("/webhooks/payment/{provider}", paymentH.Webhook)
		// Trang của cổng giả lập: chỉ dev (config chặn fake ở production)
		if !s.deps.Config.IsProduction() {
			fakeH := paymentsvc.NewFakeHandler(fakeGW, s.deps.Log)
			r.Get("/dev/fake-gateway/{txn}", fakeH.Session)
			r.Post("/dev/fake-gateway/{txn}", fakeH.Complete)
		}

		// Thư viện cá nhân (trang Bạn, Sưu tập): mọi route đều cần đăng nhập
		r.Route("/me", func(r chi.Router) {
			r.Use(requireAuth)
			r.Get("/following", channelH.Following)
			r.Get("/stats", libraryH.Stats)
			r.Get("/media/{slug}", libraryH.MediaState)

			r.Get("/continue", libraryH.Continue)
			r.Get("/history", libraryH.History)
			r.Delete("/history", libraryH.ClearHistory)
			r.Put("/history/{slug}", libraryH.SaveProgress)
			r.Delete("/history/{slug}", libraryH.RemoveHistory)

			r.Get("/saved", libraryH.Saved)
			r.Put("/saved/{slug}", libraryH.Save)
			r.Delete("/saved/{slug}", libraryH.Unsave)

			r.Get("/playlists", libraryH.Playlists)
			r.Post("/playlists", libraryH.CreatePlaylist)
			r.Get("/playlists/{id}", libraryH.Playlist)
			r.Patch("/playlists/{id}", libraryH.RenamePlaylist)
			r.Delete("/playlists/{id}", libraryH.DeletePlaylist)
			r.Put("/playlists/{id}/items/{slug}", libraryH.AddItem)
			r.Delete("/playlists/{id}/items/{slug}", libraryH.RemoveItem)

			r.Get("/products/{slug}", productH.State)
			r.Get("/favorites", productH.Favorites)
			r.Put("/favorites/{slug}", productH.AddFavorite)
			r.Delete("/favorites/{slug}", productH.RemoveFavorite)

			r.Get("/cart", cartH.Get)
			r.Put("/cart/items/{variantID}", cartH.Set)
			r.Delete("/cart/items/{variantID}", cartH.Remove)
			r.Post("/cart/merge", cartH.Merge)

			r.Get("/orders", orderH.List)
			r.Post("/orders", orderH.Checkout)
			r.Get("/orders/{code}", orderH.Get)
			r.Post("/orders/{code}/cancel", orderH.Cancel)

			r.Get("/bookings", bookingH.List)
			r.Post("/bookings", bookingH.Hold)
			r.Get("/bookings/{code}", bookingH.Get)
			r.Put("/bookings/{code}/details", bookingH.SetDetails)
			r.Post("/bookings/{code}/cancel", bookingH.Cancel)
			r.Post("/bookings/{code}/pay", paymentH.Start)
		})

		r.Get("/media/{slug}/comments", commentH.List("media"))
		r.With(requireAuth).Post("/media/{slug}/comments", commentH.Create("media"))
		r.Get("/news/{slug}/comments", commentH.List("news"))
		r.With(requireAuth).Post("/news/{slug}/comments", commentH.Create("news"))
		r.Get("/comments/{id}/replies", commentH.Replies)
		r.With(requireAuth).Post("/comments/{id}/like", commentH.Like)
		r.With(requireAuth).Delete("/comments/{id}/like", commentH.Unlike)
		r.With(requireAuth).Delete("/comments/{id}", commentH.Delete)

		// /news/categories khai báo trước /news/{slug}; chi luôn ưu tiên đường dẫn tĩnh, nên
		// "categories" không bao giờ bị hiểu nhầm là một slug bài viết.
		r.Get("/news/categories", newsH.Categories)
		r.Get("/news", newsH.List)
		r.Get("/news/{slug}", newsH.Get)
		r.Get("/news/{slug}/related", newsH.Related)
	})

	return r, nil
}

func parsePrefixes(list []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			return nil, fmt.Errorf("HTTP_TRUSTED_PROXIES có giá trị sai %q: %w", s, err)
		}
		out = append(out, p)
	}
	return out, nil
}
```

- Route webhook **công khai** (nằm ngoài nhóm `/me`); route `/dev/fake-gateway/…` chỉ đăng ký khi
  `!IsProduction()`.
- `POST /me/bookings/{code}/pay` nằm trong nhóm `/me` (cần đăng nhập).

### Bước 4: Worker đối soát, `backend/cmd/worker/main.go`

Bản đầy đủ:

```go
// Command worker chạy các việc nền: nhận job từ RabbitMQ (gửi email…) và các việc định kỳ
// (gom lượt xem từ Redis về PostgreSQL…). File này lớn dần qua các phần của khoá học.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/booking"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	paymentsvc "github.com/PhamVanPhuc2k2/airlife/backend/internal/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/mailer"
	paypkg "github.com/PhamVanPhuc2k2/airlife/backend/pkg/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker dừng do lỗi", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.Log.Level, cfg.Log.Format)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPostgres(ctx, cfg.Postgres.URL, cfg.Postgres.MaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb, err := cache.NewRedis(ctx, cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }() // lỗi khi đóng lúc tắt không xử lý được gì thêm

	mq, err := queue.NewRabbitMQ(cfg.RabbitMQ.URL)
	if err != nil {
		return err
	}
	defer func() { _ = mq.Close() }()

	log.Info("worker đang chạy", "env", cfg.App.Env)

	// Gửi mail: dev gửi vào Mailpit (MAIL_SMTP_ADDR do docker-compose.yml đặt)
	if cfg.Mail.SMTPAddr == "" {
		return errors.New("thiếu biến môi trường MAIL_SMTP_ADDR")
	}
	smtp, err := mailer.NewSMTP(cfg.Mail.SMTPAddr, cfg.Mail.From)
	if err != nil {
		return err
	}
	if err := queue.DeclareJobQueue(mq, mail.Queue); err != nil {
		return err
	}

	// Các việc nền chạy trong goroutine riêng, dùng chung loopCtx. Khi run() kết thúc (tắt worker,
	// mất RabbitMQ, hay một việc nền lỗi), defer dưới đây huỷ loopCtx rồi CHỜ mọi việc dừng hẳn.
	// defer chạy theo thứ tự ngược, nên defer này (khai báo sau cùng) chạy TRƯỚC các defer đóng
	// PostgreSQL, Redis ở trên: lần gom lượt xem cuối vẫn còn kết nối để dùng.
	mediaSvc := media.NewService(media.NewRepository(db.New(pool)), rdb)
	// Đối soát thanh toán cần gọi được cổng và đẩy email xác nhận. Dựng TRƯỚC khi tạo loopCtx: trả
	// lỗi sớm sau khi đã có context huỷ được là rò context (govet lostcancel).
	publisher, err := queue.NewPublisher(mq)
	if err != nil {
		return err
	}
	gw := paypkg.NewFake(rdb, cfg.Payment.WebhookSecret, cfg.App.PublicURL, cfg.Payment.NotifyURL)
	paySvc := paymentsvc.NewService(pool, gw, publisher, cfg.App.PublicURL, log)

	loopCtx, stopLoop := context.WithCancel(ctx)
	var wg sync.WaitGroup
	jobErr := make(chan error, 1)
	wg.Go(func() { flushViewsLoop(loopCtx, log, mediaSvc) })
	wg.Go(func() { expireBookingsLoop(loopCtx, log, booking.NewService(pool)) })
	wg.Go(func() { reconcilePaymentsLoop(loopCtx, log, paySvc) })
	wg.Go(func() {
		// prefetch 5: mỗi lúc xử lý tối đa 5 thư chưa xong
		if err := queue.Consume(loopCtx, mq, mail.Queue, 5, log, mail.Handle(smtp)); err != nil {
			jobErr <- fmt.Errorf("nhận job gửi mail: %w", err)
		}
	})
	defer func() {
		stopLoop()
		wg.Wait()
	}()

	// Mất kết nối RabbitMQ thì thoát với lỗi để Docker khởi động lại worker
	// (restart: unless-stopped). Tự kết nối lại sẽ làm ở phần hàng đợi.
	closed := mq.NotifyClose(make(chan *amqp.Error, 1))
	select {
	case <-ctx.Done():
		log.Info("worker đã tắt")
		return nil
	case err := <-jobErr:
		return err
	case amqpErr := <-closed:
		// Phải kiểm tra nil riêng: trả thẳng một *amqp.Error nil qua kiểu error
		// sẽ ra error KHÁC nil (interface chứa con trỏ nil).
		if amqpErr == nil {
			return errors.New("kết nối rabbitmq bị đóng")
		}
		return fmt.Errorf("mất kết nối rabbitmq: %w", amqpErr)
	}
}

// flushViewsLoop: 30 giây một lần, gom lượt xem từ Redis vào PostgreSQL (internal/media/views.go).
// Lần gom cuối khi tắt worker dùng context mới, vì ctx đã bị huỷ.
func flushViewsLoop(ctx context.Context, log *slog.Logger, svc *media.Service) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	flush := func(ctx context.Context) {
		n, err := svc.FlushViews(ctx)
		if err != nil {
			log.ErrorContext(ctx, "gom lượt xem lỗi", "err", err)
			return
		}
		if n > 0 {
			log.InfoContext(ctx, "đã gom lượt xem", "media", n)
		}
	}
	for {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			flush(shutdownCtx)
			cancel()
			return
		case <-ticker.C:
			flush(ctx)
		}
	}
}

// expireBookingsLoop: 30 giây một lần, huỷ các đơn giữ chỗ quá hạn và trả ghế (Phần 08).
// Đơn quá hạn mà vòng này chưa kịp xử lý thì API vẫn coi là hết hạn (booking.Get), nên khách không
// thấy đơn "còn giữ" quá 20 phút; chỉ có ghế được trả muộn tối đa 30 giây.
func expireBookingsLoop(ctx context.Context, log *slog.Logger, svc *booking.Service) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := svc.ExpireDue(ctx)
			if err != nil {
				log.ErrorContext(ctx, "trả ghế đơn quá hạn lỗi", "err", err)
				continue
			}
			if n > 0 {
				log.InfoContext(ctx, "đã trả ghế đơn giữ chỗ quá hạn", "dong_ghe", n)
			}
		}
	}
}

// reconcilePaymentsLoop: 2 phút một lần, hỏi cổng về các khoản thanh toán "chờ" quá 3 phút mà chưa
// thấy webhook (mất webhook, API tắt lúc cổng gọi). Webhook là đường chính; đây là lưới an toàn,
// để khách đã trả tiền không bị kẹt ở "Chờ thanh toán" tới khi hết hạn giữ chỗ.
func reconcilePaymentsLoop(ctx context.Context, log *slog.Logger, svc *paymentsvc.Service) {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := svc.Reconcile(ctx)
			if err != nil {
				log.ErrorContext(ctx, "đối soát thanh toán lỗi", "err", err)
				continue
			}
			if n > 0 {
				log.InfoContext(ctx, "đối soát thanh toán: đã áp kết quả", "khoan", n)
			}
		}
	}
}
```

Worker cần gọi cổng (hỏi trạng thái) và đẩy email xác nhận, nên dựng cổng và `queue.NewPublisher`.
**Dựng trước khi tạo `loopCtx`**: lần đầu tôi đặt sau, và `return err` khi `NewPublisher` lỗi nằm giữa lúc
đã có `stopLoop` mà chưa `defer`; govet `lostcancel` báo "this return statement may be reached without
using the stopLoop var". Quy tắc: mọi việc có thể trả lỗi sớm làm trước, việc tạo context huỷ được làm sau.

Vòng đối soát 2 phút một lần, quét khoản `pending` quá 3 phút: webhook thường tới trong vài giây, nên một
khoản chờ lâu hơn vậy là có vấn đề (mất webhook, API tắt lúc cổng gọi).

### Bước 5: Trả khoản thanh toán trong đơn đặt chỗ, `backend/internal/booking/booking.go`

Thêm `PaymentInfo{Status, RefundRequired}` và trường `Payment *PaymentInfo` vào `Booking`, điền trong `Get`
bằng `GetLatestPayment`. Trang đặt chỗ dựa vào đó để hiện "Thanh toán chưa thành công", "sẽ hoàn tiền"…

## Kiểm tra

```bash
make fmt && make lint
make restart s=api && make restart s=worker
docker compose logs --tail 5 api   # không có lỗi "PAYMENT_WEBHOOK_SECRET"
```

Thử cấu hình nguy hiểm (production + cổng giả lập):

```bash
docker compose run --rm --no-deps -e APP_ENV=production api go run ./cmd/api
# ERROR api dừng do lỗi err="PAYMENT_PROVIDER=fake không được dùng ở production"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| API không khởi động: `thiếu biến môi trường bắt buộc: PAYMENT_WEBHOOK_SECRET` | Thêm ba dòng `PAYMENT_*` vào `backend/.env` rồi `make restart s=api` |
| `make lint`: `lostcancel` ở worker | Dựng publisher trước khi `context.WithCancel` |
