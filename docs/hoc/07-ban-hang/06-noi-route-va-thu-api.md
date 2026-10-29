# Bài 7.06: Nối route, trang chủ, thử toàn bộ API bán hàng

> [← Bài trước](05-module-dat-hang.md) · [Mục lục](../README.md) · [Bài sau →](07-frontend-danh-muc.md)

## Mục tiêu

- Nối API sản phẩm, giỏ, đơn hàng vào router; cho phép header `Idempotency-Key` qua CORS.
- Trang chủ có khối "Kinh doanh" (hàng bán chạy); trang Bạn có số đơn hàng.
- Thử bằng curl, kể cả hai người cùng mua món cuối cùng.

## Bạn sẽ học

- Header tự đặt phải khai báo trong CORS, nếu không trình duyệt chặn ngay ở preflight.
- Thử tranh chấp (race) bằng hai request chạy song song trong bash (`&` và `wait`).

## Viết code

### Bước 1: `backend/internal/server/server.go`

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
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/product"
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

- **`AllowedHeaders` có `Idempotency-Key`**: trình duyệt gửi request `OPTIONS` (preflight) hỏi trước "có
  được gửi header này không"; không có trong danh sách là request thật không bao giờ được gửi.
- **Xem sản phẩm và preview giỏ không cần đăng nhập**; giỏ trên server, yêu thích, đơn hàng nằm trong nhóm
  `/me`.

### Bước 2: Trang chủ, `backend/internal/home/home.go`

```go
// Package home: dữ liệu trang chủ trong MỘT lần gọi API (thay vì frontend gọi 4–5 API).
//
// Bố cục theo bản vẽ tay của mockup:
//
//	┌ 3 ô bên trái ┐┌──── khối nổi bật ────┐┌ bình luận nổi bật ┐
//	└──────────────┘└──────────────────────┘└─────────────────────┘
//	[ hàng 4 thẻ xem nhiều ]
//	[ Nghe nhiều ] [ Kinh doanh ] [ Tiện ích (Phần 10) ]
package home

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/product"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Trang chủ là trang nhiều người mở nhất: cache 60 giây. Nội dung mới đăng chậm nhất
// 1 phút mới lên trang chủ, đổi lại database gần như không phải làm gì cho trang này.
const cacheTTL = 60 * time.Second

type Home struct {
	Featured  *media.Card    `json:"featured"`
	Latest    []media.Card   `json:"latest"`     // 3 ô bên trái: phim mới
	Trending  []media.Card   `json:"trending"`   // hàng 4 thẻ: xem nhiều
	TopListen []media.Card   `json:"top_listen"` // khối "Nghe nhiều"
	Shop      []product.Card `json:"shop"`       // khối "Kinh doanh": hàng bán chạy
	// Cột "Bình luận nổi bật", hai tab: Hay (nhiều thích), Nhiều (nhiều trả lời)
	HotComments struct {
		Top     []comment.HotComment `json:"top"`
		Replied []comment.HotComment `json:"replied"`
	} `json:"hot_comments"`
}

type Service struct {
	media    *media.Service // dùng service của module khác, không gọi thẳng repository của nó
	comments *comment.Service
	products *product.Service
	rdb      *redis.Client
}

func NewService(m *media.Service, c *comment.Service, p *product.Service, rdb *redis.Client) *Service {
	return &Service{media: m, comments: c, products: p, rdb: rdb}
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
	if h.Shop, err = s.products.TopSelling(ctx, "kinh-doanh", 4); err != nil {
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

### Bước 3: Số đơn hàng ở trang Bạn

Trong `backend/internal/db/queries/library.sql`, `GetLibraryStats` thêm một dòng (nhớ thêm dấu phẩy ở dòng
trước):

```sql
       (SELECT count(*) FROM orders o WHERE o.user_id = sqlc.arg('user_id')) AS orders;
```

và `Orders int64 `json:"orders"`` vào struct `Stats` trong `backend/internal/library/library.go`.

```bash
make sqlc && make fmt && make lint
```

## Kiểm tra

Lưu thành `thu7.sh` ở **ngoài** repo, chạy `bash thu7.sh`:

```bash
A=localhost:8080/api/v1; H='-H Content-Type:application/json'; O='-H Origin:http://localhost:3000'; M=localhost:8025/api/v1
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
echo "--- danh mục"
curl -s "$A/products?category=kinh-doanh&tag=mien-thue" | J "[(p['name'],p['price']) for p in d['data']['items']]"
curl -s "$A/products?category=kinh-doanh&sort=bestseller&limit=3" | J "[(p['name'],p['sold_count']) for p in d['data']['items']], bool(d['data'].get('next_cursor'))"
curl -s "$A/products/nuoc-hoa-aviator-edp" | J "d['data']['tag_name'], d['data']['delivery_methods'], [(v['label'],v['price'],v['stock']) for v in d['data']['variants']], [m['slug'] for m in d['data']['media']]"
curl -s "$A/media/vung-troi-cuoi-cung/products" | J "[p['name'] for p in d['data']]"
V() { curl -s "$A/products/$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['variants'][$2]['id'])"; }
NH=$(V nuoc-hoa-aviator-edp 0); CF=$(V ca-phe-buon-ma-thuot-rang-moc 0); DH=$(V dong-ho-pilot-chronograph 0); GOI=$(V goi-co-memory-foam-du-lich 1)
echo "--- giỏ của khách (preview)"
curl -s $H -d "{\"items\":[{\"variant_id\":\"$NH\",\"quantity\":1},{\"variant_id\":\"$CF\",\"quantity\":2},{\"variant_id\":\"$GOI\",\"quantity\":1},{\"variant_id\":\"$CF\",\"quantity\":1}]}" $A/cart/preview | J "[(l['product']['name'],l['quantity'],l.get('problem','')) for l in d['data']['lines']], d['data']['subtotal'], d['data']['delivery_methods'], d['data']['ready']"
echo "--- đăng ký, gộp giỏ"
curl -s -X DELETE $M/messages >/dev/null
E="thu7-$(date +%s)@example.com"
curl -s -o /dev/null -c j.txt $H $O -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Bảy\"}" $A/auth/register
C="-b j.txt $O"
curl -s $C $H -d "{\"items\":[{\"variant_id\":\"$NH\",\"quantity\":1},{\"variant_id\":\"$CF\",\"quantity\":2}]}" $A/me/cart/merge | J "d['data']['count']"
curl -s $C $H -d "{\"items\":[{\"variant_id\":\"$NH\",\"quantity\":1},{\"variant_id\":\"$CF\",\"quantity\":2}]}" $A/me/cart/merge | J "'gộp lần 2, count =', d['data']['count'], d['data']['delivery_methods'], d['data']['ready']"
K1=key-$(date +%s%N)
GATE='{"delivery_method":"gate","recipient_name":"Thu Bảy","phone":"0901 234 567","flight_code":"vn 220","flight_date":"'$(date -d tomorrow +%F)'"}'
echo "--- đặt khi chưa xác minh"; curl -s $C $H -H "Idempotency-Key: $K1" -d "$GATE" $A/me/orders | J "d['error']['code']"
sleep 2; ID=$(curl -s $M/messages | J "d['messages'][0]['ID']"); TOKEN=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
curl -s -o /dev/null $H $O -d "{\"token\":\"$TOKEN\"}" $A/auth/verify-email
echo "--- không có key"; curl -s $C $H -d "$GATE" $A/me/orders | J "d['error']['code']"
echo "--- không có cách nhận chung"; curl -s $C $H -H "Idempotency-Key: $K1" -d "$GATE" $A/me/orders | J "d['error']['code']"
curl -s -o /dev/null $C -X DELETE $A/me/cart/items/$CF
echo "--- form sai"; curl -s $C $H -H "Idempotency-Key: $K1" -d '{"delivery_method":"gate","recipient_name":"T","phone":"123","flight_code":"xx","flight_date":"2020-01-01"}' $A/me/orders | J "d['error']['fields']"
echo "--- đặt thành công, gửi lại cùng key"
curl -s $C $H -H "Idempotency-Key: $K1" -d "$GATE" $A/me/orders | J "d['data']['code'], d['data']['status'], d['data']['flight_code'], d['data']['total']" | tee code1.txt
curl -s $C $H -H "Idempotency-Key: $K1" -d "$GATE" $A/me/orders | J "d['data']['code']"
curl -s $C $A/me/cart | J "'giỏ sau khi đặt:', d['data']['count']"
curl -s "$A/products/nuoc-hoa-aviator-edp" | J "'tồn kho 100ml:', d['data']['variants'][0]['stock']"
sleep 2; curl -s $M/messages | J "[m['Subject'] for m in d['messages']][:1]"
echo "--- món cuối cùng: 2 người cùng mua đồng hồ (còn 3, mỗi người 2)"
E2="thu7b-$(date +%s)@example.com"
curl -s -o /dev/null -c k.txt $H $O -d "{\"email\":\"$E2\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Bảy B\"}" $A/auth/register
sleep 2; ID=$(curl -s $M/messages | J "[m['ID'] for m in d['messages'] if m['Subject'].startswith('Xác minh')][0]"); TOKEN=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
curl -s -o /dev/null $H $O -d "{\"token\":\"$TOKEN\"}" $A/auth/verify-email
for f in j.txt k.txt; do curl -s -o /dev/null -b $f $O $H -X PUT -d '{"quantity":2}' $A/me/cart/items/$DH; done
curl -s -b j.txt $O $H -H "Idempotency-Key: a-$RANDOM$RANDOM" -d "$GATE" $A/me/orders > r1.txt &
curl -s -b k.txt $O $H -H "Idempotency-Key: b-$RANDOM$RANDOM" -d "$GATE" $A/me/orders > r2.txt &
wait
for f in r1.txt r2.txt; do python3 -c "import json;d=json.load(open('$f'));print(d['data']['code'] if 'data' in d else d['error'])"; done
curl -s "$A/products/dong-ho-pilot-chronograph" | J "'tồn kho đồng hồ:', d['data']['variants'][0]['stock']"
echo "--- huỷ đơn"
CODE=$(cut -d' ' -f1 code1.txt)
curl -s $C -X POST $A/me/orders/$CODE/cancel | J "d['data']['status']"
curl -s "$A/products/nuoc-hoa-aviator-edp" | J "'tồn kho 100ml sau huỷ:', d['data']['variants'][0]['stock']"
curl -s $C -X POST $A/me/orders/$CODE/cancel | J "d['error']['code']"
curl -s -b k.txt $A/me/orders/$CODE | J "'người khác xem:', d['error']['code']"
curl -s $C $A/me/orders | J "[(o['code'][:3],o['status'],o['first_name'],o['item_count']) for o in d['data']['items']]"
rm -f j.txt k.txt r1.txt r2.txt code1.txt
```

Kết quả thật:

```text
--- danh mục
[('Nước hoa Aviator Eau de Parfum', 1390000), ('Đồng hồ Pilot Chronograph', 6490000)]
[('Vé TP.HCM – Hà Nội khứ hồi', 8120), ('Cà phê Buôn Ma Thuột rang mộc', 5320), ('Vé TP.HCM – Phú Quốc một chiều', 4630)] True
Miễn thuế ['gate'] [('100ml', 2150000, 5), ('50ml', 1390000, 12)] ['vung-troi-cuoi-cung']
['Nước hoa Aviator Eau de Parfum', 'Đồng hồ Pilot Chronograph']
--- giỏ của khách (preview)
[('Nước hoa Aviator Eau de Parfum', 1, ''), ('Cà phê Buôn Ma Thuột rang mộc', 3, ''), ('Gối cổ memory foam du lịch', 1, 'out_of_stock')] 2795000 [] False
--- đăng ký, gộp giỏ
3
gộp lần 2, count = 3 [] False
--- đặt khi chưa xác minh
email_not_verified
--- không có key
invalid_idempotency_key
--- không có cách nhận chung
no_common_delivery
--- form sai
{'flight_code': 'Số hiệu chuyến bay, VD: VN 220', 'flight_date': 'Ngày bay từ hôm nay đến 1 năm tới', 'phone': 'Số điện thoại Việt Nam không hợp lệ', 'recipient_name': 'Họ tên từ 2 đến 100 ký tự'}
--- đặt thành công, gửi lại cùng key
AL-6DF5ZP45 pending VN 220 2150000
AL-6DF5ZP45
giỏ sau khi đặt: 0
tồn kho 100ml: 4
['Airlife đã nhận đơn hàng của bạn']
--- món cuối cùng: 2 người cùng mua đồng hồ (còn 3, mỗi người 2)
AL-4DX3H5DY
{'code': 'out_of_stock', 'message': 'Đồng hồ Pilot Chronograph (Mặt 42mm) vừa hết hàng hoặc không còn đủ số lượng', 'request_id': '…'}
tồn kho đồng hồ: 1
--- huỷ đơn
cancelled
tồnTraceback (most recent call last):
  File "<string>", line 1, in <module>
    import sys,json;d=json.load(sys.stdin);print(d['data']['status'])
                                                 ~^^^^^^^^
KeyError: 'data'
```

Đọc kết quả:

- **Danh mục**: giá trên thẻ là giá "từ" (nước hoa 50ml 1.390.000₫); trang sản phẩm có đủ biến thể.
- **Giỏ của khách**: cà phê gửi hai dòng (2 + 1) được gộp thành 3; gối màu navy hết hàng báo
  `out_of_stock`; nước hoa (cửa ra máy bay) và cà phê (sân bay đến, tận nhà) không có cách nhận chung nên
  `delivery_methods` rỗng, `ready` là `False`.
- **Gộp giỏ hai lần**: vẫn 3 món, không nhân đôi.
- **Đặt hàng**: chưa xác minh email bị chặn; thiếu header báo `invalid_idempotency_key`; form sai trả lỗi
  theo từng ô; `vn 220` được chuẩn hoá thành `VN 220`.
- **Gửi lại cùng key**: cùng mã đơn, không có đơn thứ hai. Giỏ về 0, tồn kho 100ml giảm 1, Mailpit có thư
  "Airlife đã nhận đơn hàng của bạn".
- **Món cuối cùng**: còn 3 chiếc, mỗi người mua 2, chạy song song. Một người đặt được, người kia nhận
  `out_of_stock`, tồn kho còn 1, không bao giờ âm. (Tuỳ thời điểm, người thứ hai có thể nhận `cart_changed`
  nếu đọc giỏ sau khi người đầu đã trừ kho: giỏ báo "không đủ hàng" ngay từ đầu. Cả hai đường đều chặn.)
- **Huỷ đơn**: tồn kho về lại 5; huỷ lần hai báo `cannot_cancel`; người khác xem mã đơn nhận 404.

Thư xác nhận (Mailpit, bản chữ):

```text
Chào Thu Bảy,

Airlife đã nhận đơn hàng AL-4DX3H5DY. Bạn thanh toán khi nhận hàng (Nhận tại cửa ra máy bay).

- Đồng hồ Pilot Chronograph (Mặt 42mm) × 2: 12.980.000₫

Phí giao hàng: 0₫
Tổng cộng: 12.980.000₫

Xem đơn hàng: http://localhost:3000/don-hang/AL-4DX3H5DY

Airlife – Đời sống hàng không
```

Dọn dữ liệu thử. Đơn không có `ON DELETE CASCADE` theo người dùng nên xoá đơn trước. Xoá đơn **chưa huỷ**
không trả hàng về kho, nên đặt lại tồn kho của đồng hồ:

```sql
-- make psql
DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'thu7%');
DELETE FROM users WHERE email LIKE 'thu7%';
UPDATE product_variants SET stock = 3 WHERE sku = 'dong-ho-pilot-chronograph-1';
```

```bash
git add . && git commit -m "Bán hàng: sản phẩm, giỏ hàng, đặt hàng (backend)"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trình duyệt báo `Request header field idempotency-key is not allowed by Access-Control-Allow-Headers` | Thiếu `Idempotency-Key` trong `AllowedHeaders` |
| Script thử treo ở bước huỷ đơn | Biến chứa mã đơn có cả dấu cách phía sau (`AL-… pending VN 220…`), curl hiểu các từ sau là địa chỉ máy khác và chờ kết nối. Chỉ lấy từ đầu: `cut -d' ' -f1` |
| Chạy script lần hai thì phần "món cuối cùng" ra hai lỗi | Tồn kho đồng hồ chỉ còn 1 từ lần trước; đặt lại như trên |
