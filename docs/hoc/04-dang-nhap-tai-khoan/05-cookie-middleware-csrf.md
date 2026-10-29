# Bài 4.05: Cookie, middleware xác thực, chống CSRF, thử toàn bộ API

> [← Bài trước](04-dang-ky-dang-nhap.md) · [Mục lục](../README.md) · [Bài sau →](06-frontend-phien-dang-nhap.md)

## Mục tiêu

API `/auth/register`, `/login`, `/refresh`, `/logout`, `/me`, cùng middleware `Authenticate`,
`RequireAuth` và lớp chống CSRF. Thử mọi tình huống bằng `curl`, kể cả tấn công.

## Bạn sẽ học

- Thuộc tính cookie: `HttpOnly`, `Secure`, `SameSite`, `Path`, `Domain`, `MaxAge`.
- CSRF là gì, chặn bằng `SameSite` + kiểm tra `Origin`.
- "Biết ai đang gọi" (Authenticate) khác "bắt buộc đăng nhập" (RequireAuth).

## Viết code

### Bước 1: `backend/internal/auth/handler.go`

```go
package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Ba cookie:
//
//	al_access  access token (JWT). Path=/ : mọi request tới API đều gửi kèm.
//	al_refresh refresh token. Path=/api/v1/auth : trình duyệt CHỈ gửi kèm khi gọi API đăng nhập
//	           (refresh, logout); token sống lâu này không đi theo hàng trăm request khác.
//	al_session "1", KHÔNG HttpOnly: chỉ là dấu hiệu "đang có phiên" để frontend (và proxy của
//	           Next.js) biết mà không cần gọi API. Không chứa bí mật gì.
//
// HttpOnly: JavaScript không đọc được → lỗi XSS cũng không lấy được token.
// SameSite=Lax: trình duyệt không gửi cookie khi trang web KHÁC gửi form POST sang API → chặn
// phần lớn tấn công CSRF (thêm lớp kiểm tra Origin ở internal/server/middleware.go).
// Secure: chỉ gửi qua HTTPS. Tắt khi dev (http://localhost).
const (
	accessCookie  = "al_access"
	refreshCookie = "al_refresh"
	sessionCookie = "al_session"
	refreshPath   = "/api/v1/auth"
)

type CookieConfig struct {
	Domain     string
	Secure     bool
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

type Handler struct {
	svc      *Service
	log      *slog.Logger
	cookies  CookieConfig
	clientIP func(*http.Request) string
}

func NewHandler(svc *Service, log *slog.Logger, cookies CookieConfig, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, cookies: cookies, clientIP: clientIP}
}

// POST /api/v1/auth/register {email, password, display_name}
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var in RegisterInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Register(r.Context(), in, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.Created(w, sess.User)
}

// POST /api/v1/auth/login {email, password}
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Login(r.Context(), in.Email, in.Password, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/refresh — đọc cookie al_refresh, đặt cặp cookie mới
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		h.clearSession(w)
		response.Error(w, r, h.log, errRefreshInvalid)
		return
	}
	sess, err := h.svc.Refresh(r.Context(), c.Value)
	if err != nil {
		// refresh_race: KHÔNG xoá cookie, vì tab kia vừa đặt cookie mới hợp lệ
		if !errors.Is(err, errRefreshRace) {
			h.clearSession(w)
		}
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		if err := h.svc.Logout(r.Context(), c.Value); err != nil {
			response.Error(w, r, h.log, err)
			return
		}
	}
	h.clearSession(w)
	response.NoContent(w)
}

// GET /api/v1/auth/me — cần đăng nhập (RequireAuth)
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFrom(r.Context())
	u, err := h.svc.Me(r.Context(), actor.UserID)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, u)
}

func (h *Handler) setSession(w http.ResponseWriter, s Session) {
	h.cookie(w, accessCookie, s.AccessToken, "/", h.cookies.AccessTTL, true)
	h.cookie(w, refreshCookie, s.RefreshToken, refreshPath, h.cookies.RefreshTTL, true)
	h.cookie(w, sessionCookie, "1", "/", h.cookies.RefreshTTL, false)
}

func (h *Handler) clearSession(w http.ResponseWriter) {
	// MaxAge âm = xoá cookie ngay. Path, Domain phải giống lúc đặt thì trình duyệt mới xoá đúng cookie.
	h.cookie(w, accessCookie, "", "/", -1, true)
	h.cookie(w, refreshCookie, "", refreshPath, -1, true)
	h.cookie(w, sessionCookie, "", "/", -1, false)
}

func (h *Handler) cookie(w http.ResponseWriter, name, value, path string, ttl time.Duration, httpOnly bool) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	// Secure/HttpOnly là biến có chủ đích: al_session cố ý không HttpOnly (chỉ là dấu hiệu, không
	// chứa bí mật), Secure chỉ tắt khi dev. Xem comment đầu file.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: xem comment ngay trên
		Name:     name,
		Value:    value,
		Path:     path,
		Domain:   h.cookies.Domain,
		MaxAge:   maxAge,
		HttpOnly: httpOnly,
		Secure:   h.cookies.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}
```

- **`Path=/api/v1/auth` cho refresh token**: trình duyệt chỉ gửi cookie này khi gọi API đăng nhập.
  Token sống 30 ngày không đi theo hàng trăm request khác, ít chỗ có thể lộ hơn.
- **Xoá cookie**: đặt `MaxAge = -1` với **đúng** `Path` và `Domain` lúc đặt; khác một trong hai là
  trình duyệt coi như cookie khác, cookie cũ vẫn còn.
- **`//nolint:gosec // G124`**: gosec cảnh báo cookie thiếu `Secure`/`HttpOnly`. Ở đây giá trị đó là
  biến có chủ đích, nên tắt cảnh báo đúng dòng và ghi lý do.

### Bước 2: `backend/internal/auth/middleware.go`

```go
package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Authenticate đọc access token (cookie al_access, hoặc header "Authorization: Bearer …" cho
// app di động sau này) và gắn Actor vào context. KHÔNG chặn request: API công khai (danh sách
// phim…) vẫn chạy cho khách chưa đăng nhập. Chặn là việc của RequireAuth.
func Authenticate(tokens *TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := ""
			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				raw = strings.TrimPrefix(h, "Bearer ")
			} else if c, err := r.Cookie(accessCookie); err == nil {
				raw = c.Value
			}
			if raw == "" {
				next.ServeHTTP(w, r)
				return
			}
			actor, err := tokens.Parse(raw)
			state := authState{}
			switch {
			case err == nil:
				state.actor = &actor
			case errors.Is(err, errTokenExpired):
				state.expired = true
			}
			next.ServeHTTP(w, r.WithContext(withState(r.Context(), state)))
		})
	}
}

// RequireAuth chặn request chưa đăng nhập: 401 token_expired (frontend tự làm mới rồi thử lại)
// hoặc 401 unauthorized (chuyển tới trang đăng nhập).
func RequireAuth(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s, _ := r.Context().Value(ctxKey{}).(authState)
			switch {
			case s.actor != nil:
				next.ServeHTTP(w, r)
			case s.expired:
				response.Error(w, r, log, errTokenExpired)
			default:
				response.Error(w, r, log, errUnauthorized)
			}
		})
	}
}
```

`errors.Is(err, errTokenExpired)` thay vì `err == errTokenExpired`: lint `errorlint` bắt đổi, và đúng
là nên đổi; `errors.Is` vẫn nhận ra lỗi khi nó bị bọc (`fmt.Errorf("...: %w", err)`).

### Bước 3: CSRF và `sameOrigin`

**CSRF**: khách đang đăng nhập Airlife, mở trang `ke-gian.com`. Trang đó có một form ẩn tự gửi POST tới
`api.airlife.vn/...`. Trình duyệt **tự gửi kèm cookie** của Airlife, API tưởng chính khách thao tác.

- `SameSite=Lax`: trình duyệt không gửi cookie với POST từ trang khác site. Chặn phần lớn trường hợp.
- Thêm một lớp: trình duyệt luôn gửi header `Origin` với POST, và trang khác **không giả được** header
  này. Thêm vào cuối `backend/internal/server/middleware.go`:

```go
// sameOrigin chống CSRF cho request làm thay đổi dữ liệu (POST, PUT, PATCH, DELETE).
// … (comment đầy đủ trong file)
func sameOrigin(allowed []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !slices.Contains(allowed, origin) {
				response.Error(w, r, slog.Default(),
					apperr.Forbidden("origin_not_allowed", "Yêu cầu bị từ chối"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

(thêm `"slices"` vào import). Bản đầy đủ của file:

```go
package server

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	"slices"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type ctxKey int

const clientIPKey ctxKey = iota

// ClientIP trả IP thật của khách (đã qua middleware realIP). Dùng cho rate limit, log.
func ClientIP(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey).(string)
	return ip
}

// realIP xác định IP thật của khách.
//
// Production: khách → Cloudflare → nginx → API. Nếu chỉ đọc r.RemoteAddr thì mọi
// request đều mang IP của nginx, rate limit sẽ chặn tất cả mọi người cùng lúc.
//
// Nhưng header thì ai cũng tự đặt được: kẻ gian gửi thẳng "CF-Connecting-IP: 1.2.3.4"
// là đổi được IP để né rate limit. Vì vậy chỉ tin header khi request đi tới từ một
// proxy nằm trong HTTP_TRUSTED_PROXIES; còn lại dùng RemoteAddr.
//
// chi có sẵn middleware.RealIP nhưng nó tin header vô điều kiện, nên tự viết.
func realIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := remoteIP(r.RemoteAddr)
			if isTrusted(ip, trusted) {
				for _, h := range []string{"CF-Connecting-IP", "X-Real-IP"} {
					if v, err := netip.ParseAddr(r.Header.Get(h)); err == nil {
						ip = v
						break
					}
				}
			}
			ctx := context.WithValue(r.Context(), clientIPKey, ip.String())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func remoteIP(remoteAddr string) netip.Addr {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip, _ := netip.ParseAddr(host)
	return ip.Unmap() // "::ffff:127.0.0.1" → "127.0.0.1" để so được với prefix IPv4
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// requestLogger ghi một dòng log cho mỗi request, kèm request_id để lần theo lỗi:
// frontend báo "request_id=abc" → tìm đúng dòng log đó.
func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK // handler không gọi WriteHeader
			}
			// Docker gọi /healthz 5 giây một lần; ghi log hết thì log toàn dòng healthz.
			if r.URL.Path == "/healthz" && status < 500 {
				return
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			log.Log(r.Context(), level, "http",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"ip", ClientIP(r.Context()),
			)
		})
	}
}

// recoverer bắt panic trong handler: ghi log kèm stack trace, trả 500 dạng JSON
// đúng khuôn của API, và giữ cho server tiếp tục chạy.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// http.ErrAbortHandler là cách net/http chủ động huỷ request, không phải lỗi.
				//nolint:errorlint // rec là giá trị panic (any), không phải lỗi bị bọc; net/http panic đúng giá trị này
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				log.ErrorContext(r.Context(), "panic",
					"panic", rec,
					"request_id", middleware.GetReqID(r.Context()),
					"stack", string(debug.Stack()),
				)
				response.Error(w, r, log, apperr.Internal(nil))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// sameOrigin chống CSRF cho request làm thay đổi dữ liệu (POST, PUT, PATCH, DELETE).
//
// CSRF: khách đang đăng nhập Airlife, mở một trang web xấu; trang đó lén gửi form POST tới API
// Airlife. Trình duyệt tự gửi kèm cookie đăng nhập, API tưởng chính khách thao tác.
// Cookie SameSite=Lax đã chặn phần lớn trường hợp; lớp này chặn tiếp: trình duyệt luôn gửi
// header Origin (trang gốc của request) với request POST, và trang web xấu không giả được header
// này. Origin không nằm trong danh sách domain của mình → từ chối.
//
// Không có Origin (curl, server Next.js gọi từ trong mạng Docker) thì cho qua: không phải trình
// duyệt nên không có cookie của khách để lợi dụng.
func sameOrigin(allowed []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !slices.Contains(allowed, origin) {
				response.Error(w, r, slog.Default(),
					apperr.Forbidden("origin_not_allowed", "Yêu cầu bị từ chối"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

### Bước 4: Nối dây, `backend/internal/server/server.go`

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

	homeH := home.NewHandler(home.NewService(mediaSvc, s.deps.Redis), s.deps.Log)

	authCfg := s.deps.Config.Auth
	tokens := auth.NewTokenIssuer(authCfg.JWTSecret, authCfg.AccessTTL)
	authSvc, err := auth.NewService(q, s.deps.Redis, tokens, auth.NewSessions(s.deps.Redis, authCfg.RefreshTTL))
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
		})

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

- **`r.Use(auth.Authenticate(tokens))`** cho cả `/api/v1`: API công khai vẫn chạy cho khách, nhưng nếu
  có đăng nhập thì biết là ai (sau này: "đã thích video này chưa").
- **`r.With(requireAuth).Get("/me", …)`**: chỉ route này bắt buộc đăng nhập.
- **`Secure: Env != "development"`**: dev chạy `http://localhost`, cookie `Secure` sẽ không được gửi.

## Kiểm tra

Lưu cookie vào file như trình duyệt (`-c` ghi, `-b` đọc):

```bash
A=localhost:8080/api/v1/auth; H='-H Content-Type:application/json'
curl -s -c jar.txt $H -d '{"email":"Minh.Anh@Example.com","password":"matkhau-rat-dai","display_name":"Minh Anh"}' $A/register
curl -s -b jar.txt $A/me                         # thông tin tài khoản
curl -s $A/me                                    # 401 unauthorized
curl -s $H -d '{"email":"minh.anh@example.com","password":"matkhau-rat-dai","display_name":"X Y"}' $A/register
                                                 # 409 email_taken (khác hoa thường vẫn là trùng)
curl -s -H "Origin: https://ke-gian.com" $H -d '{"email":"a@b.c","password":"x"}' $A/login
                                                 # 403 origin_not_allowed
```

Xoay vòng và phát hiện đánh cắp:

```bash
cp jar.txt jar-cu.txt                            # "kẻ gian" sao chép cookie
curl -s -b jar.txt -c jar.txt -X POST $A/refresh # 200, cookie đổi token mới
curl -s -b jar-cu.txt -X POST $A/refresh         # ngay lập tức: 401 refresh_race (hai tab tranh nhau)
sleep 11
curl -s -b jar-cu.txt -X POST $A/refresh         # sau 10 giây: 401 session_revoked
curl -s -b jar.txt -X POST $A/refresh            # token MỚI cũng bị thu hồi: 401 refresh_invalid
```

Dò mật khẩu:

```bash
for i in 1 2 3 4 5 6; do curl -s $H -d '{"email":"minh.anh@example.com","password":"sai"}' $A/login; echo; done
# 5 lần invalid_credentials, lần 6 too_many_attempts; nhập đúng lúc này cũng bị chặn 15 phút
curl -s $H -d '{"email":"khong-co@example.com","password":"x"}' $A/login
# invalid_credentials: cùng câu với sai mật khẩu
```

Token giả mạo `alg: none` (không có chữ ký, tự đặt `role: admin`):

```bash
NONE=$(python3 -c "import base64,json;b=lambda x: base64.urlsafe_b64encode(json.dumps(x).encode()).rstrip(b'=').decode();print(b({'alg':'none','typ':'JWT'})+'.'+b({'role':'admin','iss':'airlife','sub':'00000000-0000-0000-0000-000000000000','exp':9999999999})+'.')")
curl -s -b "al_access=$NONE" $A/me               # 401 unauthorized
```

```bash
rm -f jar.txt jar-cu.txt
make lint && make vuln
git add . && git commit -m "API đăng nhập, middleware, chống CSRF"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đăng xuất xong vẫn còn cookie | `clearSession` đặt Path/Domain khác lúc `setSession` |
| Trình duyệt không lưu cookie khi dev | Cookie `Secure` trên `http://`: kiểm tra `APP_ENV=development` |
| POST từ frontend bị `origin_not_allowed` | Domain frontend chưa có trong `HTTP_CORS_ORIGINS` |
