# Bài 2.07: API trang chủ, nối dây router, kiểm tra toàn bộ

> [← Bài trước](06-dem-luot-xem.md) · [Mục lục](../README.md) · [Bài sau →](08-goi-api-tu-nextjs.md)

## Mục tiêu

`GET /api/v1/home` trả đủ dữ liệu trang chủ trong một lần gọi. Mọi API của Phần 02 được gắn vào
router và kiểm tra bằng `curl`.

## Bạn sẽ học

- API "gom" (aggregate) cho một trang: ít round-trip, cache một chỗ.
- Module này dùng module khác qua **service**, không qua repository.
- Nối dây (dependency wiring) bằng tay ở một chỗ.

## Viết code

### Bước 1: `backend/internal/home/home.go`

```go
// Package home: dữ liệu trang chủ trong MỘT lần gọi API (thay vì frontend gọi 4–5 API).
//
// Bố cục theo bản vẽ tay của mockup:
//
//	┌ 3 ô bên trái ┐┌──── khối nổi bật ────┐┌ bình luận (Phần 04) ┐
//	└──────────────┘└──────────────────────┘└─────────────────────┘
//	[ hàng 4 thẻ xem nhiều ]
//	[ Nghe nhiều ] [ Kinh doanh (Phần 07) ] [ Tiện ích (Phần 10) ]
package home

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Trang chủ là trang nhiều người mở nhất: cache 60 giây. Nội dung mới đăng chậm nhất
// 1 phút mới lên trang chủ, đổi lại database gần như không phải làm gì cho trang này.
const cacheTTL = 60 * time.Second

type Home struct {
	Featured  *media.Card  `json:"featured"`
	Latest    []media.Card `json:"latest"`     // 3 ô bên trái: phim mới
	Trending  []media.Card `json:"trending"`   // hàng 4 thẻ: xem nhiều
	TopListen []media.Card `json:"top_listen"` // khối "Nghe nhiều"
}

type Service struct {
	media *media.Service // dùng service của module media, không gọi thẳng repository của nó
	rdb   *redis.Client
}

func NewService(m *media.Service, rdb *redis.Client) *Service {
	return &Service{media: m, rdb: rdb}
}

func (s *Service) Get(ctx context.Context) (Home, error) {
	return cache.Remember(ctx, s.rdb, "cache:home", cacheTTL, s.load)
}

func (s *Service) load(ctx context.Context) (Home, error) {
	var h Home

	featured, err := s.media.Featured(ctx, 1)
	if err != nil {
		return h, err
	}
	if len(featured) > 0 {
		h.Featured = &featured[0]
	}

	latest, err := s.media.List(ctx, media.ListParams{Category: "xem", Sort: "new", Limit: 4})
	if err != nil {
		return h, err
	}
	h.Latest = excludeFeatured(latest.Items, h.Featured, 3)

	trending, err := s.media.List(ctx, media.ListParams{Category: "xem", Sort: "popular", Limit: 8})
	if err != nil {
		return h, err
	}
	// Không lặp lại phim đã có ở khối nổi bật và 3 ô bên trái
	shown := map[string]bool{}
	if h.Featured != nil {
		shown[h.Featured.Slug] = true
	}
	for _, c := range h.Latest {
		shown[c.Slug] = true
	}
	h.Trending = make([]media.Card, 0, 4)
	for _, c := range trending.Items {
		if !shown[c.Slug] && len(h.Trending) < 4 {
			h.Trending = append(h.Trending, c)
		}
	}

	listen, err := s.media.List(ctx, media.ListParams{Category: "nghe", Sort: "popular", Limit: 5})
	if err != nil {
		return h, err
	}
	h.TopListen = listen.Items
	return h, nil
}

func excludeFeatured(items []media.Card, featured *media.Card, n int) []media.Card {
	out := make([]media.Card, 0, n)
	for _, c := range items {
		if featured != nil && c.ID == featured.ID {
			continue
		}
		if len(out) == n {
			break
		}
		out = append(out, c)
	}
	return out
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/home
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	data, err := h.svc.Get(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, data)
}
```

- Trang chủ cần 4 nhóm dữ liệu. Frontend gọi 4 API thì 4 lần đi về qua mạng; gọi 1 API thì 1 lần,
  và cache **một** khoá `cache:home` 60 giây.
- `home` gọi `media.Service` (đã có kiểm tra, phân trang…), không gọi thẳng `media.Repository`:
  quy tắc phụ thuộc giữa các module (TASKS.md mục 2.0).
- Lọc trùng: phim ở khối nổi bật không lặp lại ở 3 ô bên trái hay hàng "xem nhiều".

### Bước 2: Gắn route trong `backend/internal/server/server.go`

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

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/category"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/home"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
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

	// Nối dây các module: repository/service/handler tạo một lần ở đây.
	q := db.New(s.deps.DB)
	clientIP := func(r *http.Request) string { return ClientIP(r.Context()) }

	categorySvc := category.NewService(q, s.deps.Redis)
	categoryH := category.NewHandler(categorySvc, s.deps.Log)

	mediaSvc := media.NewService(media.NewRepository(q), s.deps.Redis)
	mediaH := media.NewHandler(mediaSvc, s.deps.Log, clientIP)

	homeH := home.NewHandler(home.NewService(mediaSvc, s.deps.Redis), s.deps.Log)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			response.OK(w, map[string]string{"message": "pong"})
		})

		r.Get("/home", homeH.Get)

		r.Get("/categories", categoryH.List)
		r.Get("/categories/{slug}", categoryH.Get)

		r.Get("/media", mediaH.List)
		r.Get("/media/{slug}", mediaH.Get)
		r.Get("/media/{slug}/related", mediaH.Related)
		r.Post("/media/{slug}/views", mediaH.RecordView)
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

Mọi module được tạo **một lần** khi khởi động, theo thứ tự phụ thuộc: `db.Queries` → repository →
service → handler. Không dùng thư viện dependency injection; đọc từ trên xuống là thấy ai cần gì.

## Kiểm tra

Air tự build lại api. Gọi thử:

```bash
A=localhost:8080/api/v1
curl -s $A/categories                                   # 4 chuyên mục
curl -s $A/categories/xem                               # có "filters"
curl -s "$A/media?category=xem&limit=5"                 # 5 phim mới nhất + next_cursor
curl -s "$A/media?category=xem&limit=5&cursor=<next_cursor ở trên>"   # 5 phim tiếp, không trùng
curl -s "$A/media?category=xem&sort=popular&tag=phim-viet"            # phim Việt xem nhiều
curl -s "$A/media?lineup=2026-10"                       # line-up tháng 10 (theo tháng hiện tại lúc seed)
curl -s $A/media/vung-troi-cuoi-cung                    # chi tiết, có category_name, lineup_month
curl -s $A/media/vung-troi-cuoi-cung/related            # gợi ý cùng chuyên mục
curl -s $A/home                                          # featured, latest, trending, top_listen
```

Các lỗi phải trả đúng mã và `code`:

```bash
curl -s "$A/media?sort=abc"          # 400 invalid_sort
curl -s "$A/media?cursor=rac"        # 400 invalid_cursor
curl -s "$A/media?lineup=10-2026"    # 400 invalid_lineup
curl -s  $A/media/khong-co           # 404 media_not_found
```

Cache:

```bash
docker compose exec redis redis-cli -a airlife --no-auth-warning --scan --pattern 'cache:*'
# cache:home  cache:categories  cache:category:xem
```

Rồi làm phần kiểm tra lượt xem của bài 2.06.

```bash
make lint && make vuln
git add . && git commit -m "API trang chủ, nối dây Phần 02"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| API mới trả `route_not_found` | Air chưa build lại (xem `make logs s=api`), hoặc route khai báo ngoài `r.Route("/api/v1", ...)` |
| `/home` trả dữ liệu cũ sau khi seed lại | Cache 60 giây; chờ hoặc `redis-cli DEL cache:home` |
| `featured` là `null` | Chưa có media nào `featured = true`: chạy `make seed` |
