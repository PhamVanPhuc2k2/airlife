# Bài 5.04: Nối route, bình luận nổi bật ở trang chủ, request bị huỷ

> [← Bài trước](03-module-binh-luan.md) · [Mục lục](../README.md) · [Bài sau →](05-du-lieu-mau-va-thu-api.md)

## Mục tiêu

- Nối API kênh và bình luận vào router.
- API `/home` có thêm cột "Bình luận nổi bật" (hai tab Hay, Nhiều).
- Request bị khách huỷ không còn bị ghi log thành lỗi 500.

## Bạn sẽ học

- Route nào cần đăng nhập (`requireAuth`), route nào khách cũng xem được.
- Module này dùng service của module khác (trang chủ dùng `comment.Service`).
- `context.Canceled`: phân biệt "khách bỏ đi" với "server hỏng".

## Viết code

### Bước 1: Routes, `backend/internal/server/server.go`

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
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/category"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/channel"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/home"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/news"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
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
		AllowedOrigins:   s.deps.Config.HTTP.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language"},
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
	homeH := home.NewHandler(home.NewService(mediaSvc, commentSvc, s.deps.Redis), s.deps.Log)

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
		r.With(requireAuth).Get("/me/following", channelH.Following)

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

- **Xem thì không cần đăng nhập, ghi thì cần**: `GET` bình luận mở cho khách (vẫn đi qua
  `auth.Authenticate`, nên người đã đăng nhập nhận thêm `liked_by_me`, `mine`); `POST`, `DELETE` đi qua
  `requireAuth`.
- **`commentSvc` tạo trước `homeH`** vì trang chủ cần nó.

### Bước 2: Trang chủ, `backend/internal/home/home.go`

```go
// Package home: dữ liệu trang chủ trong MỘT lần gọi API (thay vì frontend gọi 4–5 API).
//
// Bố cục theo bản vẽ tay của mockup:
//
//	┌ 3 ô bên trái ┐┌──── khối nổi bật ────┐┌ bình luận nổi bật ┐
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

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
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
	// Cột "Bình luận nổi bật", hai tab: Hay (nhiều thích), Nhiều (nhiều trả lời)
	HotComments struct {
		Top     []comment.HotComment `json:"top"`
		Replied []comment.HotComment `json:"replied"`
	} `json:"hot_comments"`
}

type Service struct {
	media    *media.Service // dùng service của module khác, không gọi thẳng repository của nó
	comments *comment.Service
	rdb      *redis.Client
}

func NewService(m *media.Service, c *comment.Service, rdb *redis.Client) *Service {
	return &Service{media: m, comments: c, rdb: rdb}
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

	if h.HotComments.Top, err = s.comments.Hot(ctx, false, 5); err != nil {
		return h, err
	}
	if h.HotComments.Replied, err = s.comments.Hot(ctx, true, 5); err != nil {
		return h, err
	}
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

Trang chủ cache 60 giây (bài 2.07), nên hai truy vấn bình luận nổi bật cũng chỉ chạy tối đa một lần mỗi
phút.

### Bước 3: Request bị huỷ, `backend/pkg/response/response.go`

Khi thử giao diện, log API hiện nhiều dòng thế này dù trang vẫn chạy đúng:

```text
level=ERROR msg="lỗi hệ thống" err="timeout: context already done: context canceled" ... status=500
```

Nguyên nhân: khách rời trang giữa chừng, hoặc TanStack Query huỷ request cũ khi đổi tab "Hay"/"Mới"
(`signal` ở bài 2.09). Go huỷ `r.Context()`, pgx dừng truy vấn và trả lỗi bọc `context.Canceled`. Đây
không phải lỗi server, nhưng đang bị đếm là 500 và làm lẫn log lỗi thật.

Kiểm tra trước pgx có bọc đúng `context.Canceled` không (chương trình thử, chạy xong xoá):

```go
ctx, cancel := context.WithCancel(context.Background())
cancel() // khách huỷ trước khi truy vấn chạy
_, err = pool.Exec(ctx, "SELECT pg_sleep(1)")
fmt.Println("errors.Is(err, context.Canceled):", errors.Is(err, context.Canceled))
// errors.Is(err, context.Canceled): true
```

Sửa `Error` trong `response.go`. Bản đầy đủ:

```go
// Package response ghi phản hồi JSON theo một khuôn duy nhất cho toàn API.
//
// Thành công:  {"data": ..., "meta": {...}}       (meta chỉ có khi phân trang)
// Thất bại:    {"error": {"code": "...", "message": "...", "fields": {...}, "request_id": "..."}}
//
// Frontend chỉ cần kiểm tra có "error" hay không, và dùng "code" để rẽ nhánh.
package response

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

type body struct {
	Data  any        `json:"data,omitempty"`
	Meta  any        `json:"meta,omitempty"`
	Error *errorBody `json:"error,omitempty"`
}

type errorBody struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	Fields    map[string]string `json:"fields,omitempty"`
	RequestID string            `json:"request_id,omitempty"`
}

func JSON(w http.ResponseWriter, status int, data any) {
	write(w, status, body{Data: data})
}

func OK(w http.ResponseWriter, data any) {
	JSON(w, http.StatusOK, data)
}

func Created(w http.ResponseWriter, data any) {
	JSON(w, http.StatusCreated, data)
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// List dùng cho danh sách có phân trang.
func List(w http.ResponseWriter, data, meta any) {
	write(w, http.StatusOK, body{Data: data, Meta: meta})
}

// statusClientClosed: khách đã đóng kết nối trước khi có phản hồi (quy ước 499 của nginx).
const statusClientClosed = 499

// Error đổi lỗi thành phản hồi HTTP. Lỗi Internal được ghi log đầy đủ (kèm lỗi gốc),
// còn client chỉ nhận câu thông báo chung.
func Error(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	// Khách tự huỷ request (rời trang giữa chừng, TanStack Query huỷ request cũ): context bị huỷ
	// nên truy vấn DB dừng theo. Đây không phải lỗi hệ thống; ghi ở mức debug để log lỗi thật
	// không bị lẫn trong hàng trăm dòng "context canceled".
	if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
		log.DebugContext(r.Context(), "khách huỷ request", "path", r.URL.Path)
		w.WriteHeader(statusClientClosed)
		return
	}

	e, ok := apperr.As(err)
	if !ok {
		e = apperr.Internal(err)
	}

	reqID := middleware.GetReqID(r.Context())
	if e.Kind == apperr.KindInternal {
		log.ErrorContext(r.Context(), "lỗi hệ thống",
			"err", err, "request_id", reqID, "method", r.Method, "path", r.URL.Path)
	}

	write(w, statusOf(e.Kind), body{Error: &errorBody{
		Code:      e.Code,
		Message:   e.Message,
		Fields:    e.Fields,
		RequestID: reqID,
	}})
}

func statusOf(k apperr.Kind) int {
	switch k {
	case apperr.KindInvalid:
		return http.StatusBadRequest
	case apperr.KindUnauthorized:
		return http.StatusUnauthorized
	case apperr.KindForbidden:
		return http.StatusForbidden
	case apperr.KindNotFound:
		return http.StatusNotFound
	case apperr.KindConflict:
		return http.StatusConflict
	case apperr.KindTooMany:
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

func write(w http.ResponseWriter, status int, b body) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// Lỗi encode ở đây thường là client đã ngắt kết nối; header đã gửi nên không làm gì thêm được.
	_ = json.NewEncoder(w).Encode(b)
}
```

- **Hai điều kiện**: lỗi là `context.Canceled` **và** context của chính request đã bị huỷ. Chỉ điều kiện
  đầu thì một lỗi huỷ do code tự tạo (không phải do khách) cũng bị giấu đi.
- **499** là mã nginx dùng cho "khách đóng kết nối". Khách đã đi rồi nên không ai đọc phản hồi này; mã chỉ
  để log truy cập ghi đúng.

## Kiểm tra

```bash
make restart s=api
curl -s localhost:8080/api/v1/home | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['hot_comments'])"
# {'top': [], 'replied': []}: chưa có bình luận (bài 5.05 nạp dữ liệu mẫu)
curl -s localhost:8080/api/v1/channels/airlife | head -c 300; echo
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8080/api/v1/channels/airlife/follow   # 401
make lint
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `undefined: commentSvc` | Tạo `commentSvc` sau dòng dùng nó; đưa lên trước `homeH` |
| `/home` vẫn chưa có `hot_comments` | Cache trang chủ 60 giây còn bản cũ: chờ, hoặc `docker compose exec redis redis-cli -a airlife --no-auth-warning DEL cache:home` |
| Log vẫn có `context canceled` mức ERROR | Handler đó tự ghi log trước khi gọi `response.Error`; để `response.Error` lo việc ghi log |
