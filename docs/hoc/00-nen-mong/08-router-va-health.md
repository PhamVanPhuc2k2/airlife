# Bài 0.08: Router go-chi, CORS, health check

> [← Bài trước](07-middleware.md) · [Mục lục](../README.md) · [Bài sau →](09-cmd-api-va-worker.md)

## Mục tiêu

`internal/server` dựng router: gắn middleware theo đúng thứ tự, CORS cho frontend,
`/healthz`, `/readyz` và `/api/v1/ping`.

## Bạn sẽ học

- go-chi: router nhẹ, tương thích hoàn toàn với `net/http` chuẩn (handler vẫn là `http.HandlerFunc`).
- **Thứ tự middleware có ý nghĩa.**
- CORS là gì và vì sao trình duyệt cần nó.
- `healthz` và `readyz` khác nhau ở đâu.

## Viết code

### Bước 1: Cài CORS

```bash
cd backend
go get github.com/go-chi/cors@v1.2.2
```

**CORS**: frontend chạy ở `localhost:3000`, API ở `localhost:8080`, khác cổng nghĩa là khác
"origin". Trình duyệt mặc định chặn JavaScript gọi API khác origin, trừ khi API trả header
`Access-Control-Allow-Origin` cho phép. Gói `cors` lo việc trả các header này.

### Bước 2: `internal/server/server.go`

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

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
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
		AllowedOrigins:   s.deps.Config.HTTP.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language"},
		AllowCredentials: true, // cần để trình duyệt gửi cookie refresh token
		MaxAge:           300,
	}))
	// Huỷ context của request quá lâu (truy vấn DB treo…) và trả 504.
	// http.Server ở cmd/api đặt WriteTimeout dài hơn mức này một chút để kịp gửi 504.
	r.Use(middleware.Timeout(s.deps.Config.HTTP.WriteTimeout))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.NotFound("route_not_found", "Không tìm thấy đường dẫn"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.Invalid("method_not_allowed", "Phương thức không được hỗ trợ"))
	})

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			response.OK(w, map[string]string{"message": "pong"})
		})
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

Điểm chính:

- **`Deps`** gom mọi kết nối. `main` tạo một lần rồi truyền vào; handler không tự mở kết nối.
- **Thứ tự middleware**: `realIP` và `RequestID` phải chạy **trước** `requestLogger`, nếu không
  dòng log thiếu IP và request_id. `recoverer` đứng trước handler để bắt mọi panic phía sau.
- **`AllowCredentials: true`**: cho trình duyệt gửi cookie (refresh token ở phần đăng nhập).
  Khi bật cái này, `AllowedOrigins` **không được** là `*`, phải ghi rõ domain.
- **`middleware.Timeout`**: request quá `HTTP_WRITE_TIMEOUT` thì context bị huỷ, truy vấn DB
  đang chạy dừng theo, client nhận 504.
- **`NotFound`, `MethodNotAllowed`**: mặc định chi trả text thuần; ghi đè để trả JSON đúng khuôn.
- **`r.Route("/api/v1", ...)`**: mọi API nghiệp vụ nằm dưới `/api/v1`. Sau này đổi API mà không
  tương thích ngược thì mở `/api/v2`, app cũ vẫn chạy.

### Bước 3: `internal/server/health.go`

```go
package server

import (
	"context"
	"net/http"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// healthz: tiến trình còn sống không. Không kiểm tra DB; nếu DB chết mà healthz
// báo lỗi thì Docker/K8s sẽ khởi động lại API liên tục, mà khởi động lại không chữa được DB.
func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	response.OK(w, map[string]string{"status": "ok"})
}

// readyz: sẵn sàng nhận request chưa, tức là kết nối được cả PostgreSQL, Redis, RabbitMQ.
// Load balancer dùng endpoint này để quyết định có chuyển request vào hay không.
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	checks := map[string]string{"postgres": "ok", "redis": "ok", "rabbitmq": "ok"}
	ready := true

	if err := s.deps.DB.Ping(ctx); err != nil {
		checks["postgres"] = "lỗi"
		ready = false
	}
	if err := s.deps.Redis.Ping(ctx).Err(); err != nil {
		checks["redis"] = "lỗi"
		ready = false
	}
	if s.deps.RabbitMQ.IsClosed() {
		checks["rabbitmq"] = "lỗi"
		ready = false
	}

	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	// Không trả chi tiết lỗi (địa chỉ, tên host) ra ngoài; chỉ ok / lỗi.
	response.JSON(w, status, checks)
}
```

| | `/healthz` | `/readyz` |
|---|---|---|
| Hỏi gì | Tiến trình còn sống không? | Sẵn sàng phục vụ chưa? |
| Kiểm tra DB | Không | Có (PostgreSQL, Redis, RabbitMQ) |
| Ai dùng | Docker: chết thì khởi động lại | Load balancer: chưa sẵn sàng thì không chuyển request vào |

Nếu `healthz` cũng kiểm tra DB: DB sập → `healthz` lỗi → Docker khởi động lại API liên tục,
mà khởi động lại API không chữa được DB.

## Kiểm tra

```bash
cd backend && go mod tidy && go build ./... && go vet ./...
```

Gọi thật ở bài 0.09.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trình duyệt báo `blocked by CORS policy` | Domain frontend chưa có trong `HTTP_CORS_ORIGINS`. Phải khớp cả giao thức và cổng: `http://localhost:3000` |
| Đặt `AllowedOrigins: ["*"]` thì cookie không gửi | Trình duyệt cấm `*` khi có credentials. Ghi rõ domain |
| Route trả 404 dù đã khai báo | Khai báo sau khi đã `return r`, hoặc nhầm `/api/v1/ping` với `/api/ping` |
