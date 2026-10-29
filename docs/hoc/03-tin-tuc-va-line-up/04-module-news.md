# Bài 3.04: Module tin tức, API tháng line-up

> [← Bài trước](03-seed-tin-tuc.md) · [Mục lục](../README.md) · [Bài sau →](05-component-dung-chung.md)

## Mục tiêu

API `/news/categories`, `/news`, `/news/{slug}`, `/news/{slug}/related` và `/lineup/months`.

## Bạn sẽ học

- Khi nào **không cần** tầng repository riêng.
- Thứ tự route tĩnh và route có tham số trong go-chi.

## Viết code

### Bước 1: `backend/internal/news/news.go`

```go
// Package news: tin tức (Khám phá, Sự kiện, Mẹo bay, Line-up phim, Kinh doanh).
//
// Cấu trúc giống module media nhưng gọn hơn: không cần tầng repository riêng vì không có truy
// vấn nào phải gộp hay đổi kiểu phức tạp; service gọi thẳng code sqlc.
package news

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	defaultLimit = 12
	maxLimit     = 48
)

var (
	slugRe      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	errNotFound = apperr.NotFound("news_not_found", "Không tìm thấy bài viết")
)

type Category struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Card: bài viết trong danh sách (không có thân bài).
type Card struct {
	ID           uuid.UUID `json:"id"`
	Slug         string    `json:"slug"`
	Category     string    `json:"category"`
	CategoryName string    `json:"category_name"`
	Title        string    `json:"title"`
	Excerpt      string    `json:"excerpt"`
	CoverURL     string    `json:"cover_url"`
	Author       string    `json:"author"`
	PublishedAt  time.Time `json:"published_at"`
}

// Article: trang đọc một bài. BodyHTML đã được lọc lúc ghi (pkg/sanitize).
type Article struct {
	Card
	BodyHTML  string    `json:"body_html"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Page struct {
	Items      []Card `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

type cursor struct {
	Time time.Time `json:"t"`
	ID   uuid.UUID `json:"id"`
}

type Service struct {
	q   *db.Queries
	rdb *redis.Client
}

func NewService(q *db.Queries, rdb *redis.Client) *Service {
	return &Service{q: q, rdb: rdb}
}

func (s *Service) Categories(ctx context.Context) ([]Category, error) {
	return cache.Remember(ctx, s.rdb, "cache:news-categories", 10*time.Minute, func(ctx context.Context) ([]Category, error) {
		rows, err := s.q.ListNewsCategories(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]Category, 0, len(rows))
		for _, r := range rows {
			out = append(out, Category{Slug: r.Slug, Name: r.Name, Description: r.Description})
		}
		return out, nil
	})
}

func (s *Service) List(ctx context.Context, category, cursorStr string, limit int) (Page, error) {
	params := db.ListNewsParams{Limit: clampLimit(limit) + 1} // dư 1 dòng để biết còn trang sau
	if category != "" {
		if !slugRe.MatchString(category) {
			return Page{}, apperr.Invalid("invalid_category", "Chuyên mục không hợp lệ")
		}
		params.Category = &category
	}
	var cur cursor
	ok, err := pagination.Decode(cursorStr, &cur)
	if err != nil {
		return Page{}, err
	}
	if ok {
		params.CursorTime, params.CursorID = &cur.Time, &cur.ID
	}

	rows, err := s.q.ListNews(ctx, params)
	if err != nil {
		return Page{}, err
	}
	items := make([]Card, 0, len(rows))
	for _, r := range rows {
		items = append(items, toCard(r))
	}

	page := Page{Items: items}
	if len(items) == int(params.Limit) {
		page.Items = items[:len(items)-1]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = pagination.Encode(cursor{Time: last.PublishedAt, ID: last.ID})
	}
	return page, nil
}

func (s *Service) Get(ctx context.Context, slug string) (Article, error) {
	if !slugRe.MatchString(slug) {
		return Article{}, errNotFound
	}
	r, err := s.q.GetNewsBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Article{}, errNotFound
	}
	if err != nil {
		return Article{}, err
	}
	return Article{
		Card: Card{
			ID: r.ID, Slug: r.Slug, Category: r.CategorySlug, CategoryName: r.CategoryName,
			Title: r.Title, Excerpt: r.Excerpt, CoverURL: r.CoverUrl, Author: r.Author,
			PublishedAt: r.PublishedAt,
		},
		BodyHTML:  r.BodyHtml,
		UpdatedAt: r.UpdatedAt,
	}, nil
}

func (s *Service) Related(ctx context.Context, slug string, limit int32) ([]Card, error) {
	a, err := s.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListRelatedNews(ctx, db.ListRelatedNewsParams{
		ExcludeID: a.ID, Category: a.Category, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCard(db.ListNewsRow(r)))
	}
	return out, nil
}

func toCard(r db.ListNewsRow) Card {
	return Card{
		ID: r.ID, Slug: r.Slug, Category: r.CategorySlug, CategoryName: r.CategoryName,
		Title: r.Title, Excerpt: r.Excerpt, CoverURL: r.CoverUrl, Author: r.Author,
		PublishedAt: r.PublishedAt,
	}
}

func clampLimit(n int) int32 {
	switch {
	case n <= 0:
		return defaultLimit
	case n > maxLimit:
		return maxLimit
	default:
		return int32(n) //nolint:gosec // đã chặn trong khoảng 1..maxLimit
	}
}
```

- Không có `repository.go`: module media cần repository để gom 3 kiểu sqlc khác nhau về một `Card`;
  tin tức chỉ có hai kiểu đơn giản, service gọi thẳng `db.Queries` là đủ. Thêm tầng khi có lý do.
- Phân trang dùng `pagination.Encode/Decode` của bài 3.01; con trỏ chỉ có `{t, id}`.
- `Article` nhúng `Card` như `media.Detail` nhúng `media.Card`.

### Bước 2: `backend/internal/news/handler.go`

```go
package news

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/news/categories
func (h *Handler) Categories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.svc.Categories(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, cats)
}

// GET /api/v1/news?category=kham-pha&cursor=…&limit=12
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, err := h.svc.List(r.Context(), q.Get("category"), q.Get("cursor"), limit)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /api/v1/news/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, a)
}

// GET /api/v1/news/{slug}/related
func (h *Handler) Related(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Related(r.Context(), chi.URLParam(r, "slug"), 4)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, items)
}
```

### Bước 3: Tháng line-up trong module media

Thêm vào cuối `backend/internal/media/repository.go`:

```go
// LineupMonths: các tháng có line-up phim, mới nhất trước.
func (r *Repository) LineupMonths(ctx context.Context) ([]time.Time, error) {
	return r.q.ListLineupMonths(ctx)
}
```

`LineupMonths` trong `service.go` (đã có trong bản đầy đủ ở bài 3.01) đổi `time.Time` thành chuỗi
`"2026-10"`. Thêm vào cuối `backend/internal/media/handler.go`:

```go
// GET /api/v1/lineup/months — các tháng có line-up phim (trang Mới tải, tab Line-up)
func (h *Handler) LineupMonths(w http.ResponseWriter, r *http.Request) {
	months, err := h.svc.LineupMonths(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, months)
}
```

### Bước 4: Gắn route, `backend/internal/server/server.go`

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
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/news"
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
	newsH := news.NewHandler(news.NewService(q, s.deps.Redis), s.deps.Log)

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
		r.Get("/lineup/months", mediaH.LineupMonths)

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

`/news/categories` và `/news/{slug}`: go-chi luôn **ưu tiên đường dẫn tĩnh** trước đường dẫn có tham
số, nên `/news/categories` không bao giờ bị hiểu là bài viết có slug "categories".

## Kiểm tra

```bash
A=localhost:8080/api/v1
curl -s $A/news/categories                # 5 chuyên mục
curl -s "$A/news?limit=3"                 # 3 bài + next_cursor
curl -s "$A/news?limit=3&cursor=<next_cursor>"    # 3 bài tiếp theo, không trùng
curl -s "$A/news?category=kham-pha"       # 3 bài Khám phá
curl -s $A/news/5-meo-de-ngu-ngon-tren-chuyen-bay-duong-dai          # có body_html, không có <script>
curl -s $A/news/5-meo-de-ngu-ngon-tren-chuyen-bay-duong-dai/related  # 4 bài
curl -s $A/lineup/months                  # {"data":["2026-10"]}
curl -s $A/news/khong-co                  # 404 news_not_found
curl -s "$A/media?category=xem&limit=2"   # media vẫn chạy sau khi đổi sang pkg/pagination
```

```bash
make lint && make vuln
git add . && git commit -m "Module tin tức, API tháng line-up"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `/news/categories` trả `news_not_found` | Router khác chi có thể khớp `{slug}` trước; với chi thì kiểm tra lại đường dẫn có đúng `/news/categories` |
| `/lineup/months` trả `[]` | Chưa có media nào có `lineup_month`: `make seed` |
