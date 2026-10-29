# Bài 8.04: Worker trả chỗ, nối route, thử toàn bộ API

> [← Bài trước](03-hanh-khach-va-huy.md) · [Mục lục](../README.md) · [Bài sau →](05-frontend-chon-chuyen.md)

## Mục tiêu

- Worker 30 giây một lần hết hạn đơn quá giờ và trả chỗ.
- Nối route; thử bằng curl: giữ chỗ, chống trùng, hai người tranh chỗ cuối, giới hạn đơn đang giữ, hành
  khách, huỷ, hết hạn.

## Bạn sẽ học

- Thêm một việc định kỳ vào worker theo mẫu có sẵn (gom lượt xem, bài 2.06).
- Giả lập "hết hạn" bằng cách sửa `expires_at` thay vì chờ 20 phút.

## Viết code

### Bước 1: Worker, `backend/cmd/worker/main.go`

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
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/mailer"
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
	loopCtx, stopLoop := context.WithCancel(ctx)
	var wg sync.WaitGroup
	jobErr := make(chan error, 1)
	wg.Go(func() { flushViewsLoop(loopCtx, log, mediaSvc) })
	wg.Go(func() { expireBookingsLoop(loopCtx, log, booking.NewService(pool)) })
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
```

Thêm `wg.Go(func() { expireBookingsLoop(loopCtx, log, booking.NewService(pool)) })` cạnh vòng gom lượt
xem, và hàm `expireBookingsLoop` ở cuối file. Khác vòng gom lượt xem, khi tắt worker không cần chạy lần
cuối: lần khởi động sau sẽ hết hạn các đơn còn sót.

### Bước 2: Routes, `backend/internal/server/server.go`

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

`GET /products/{slug}/departures` công khai (khách xem lịch trước khi đăng nhập); các route đơn nằm trong
nhóm `/me`.

## Kiểm tra

Lưu thành `thu8.sh` ở **ngoài** repo, chạy ở thư mục gốc dự án (`bash ../thu8.sh`, cần `docker compose`
cho lệnh `PSQL`):

```bash
A=localhost:8080/api/v1; H='-H Content-Type:application/json'; O='-H Origin:http://localhost:3000'; M=localhost:8025/api/v1
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
PSQL() { docker compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }
user() { # đăng ký + xác minh, cookie vào file $1
  E="thu8-$1-$(date +%s%N)@example.com"
  curl -s -X DELETE $M/messages >/dev/null
  curl -s -o /dev/null -c $1 $H $O -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Tám\"}" $A/auth/register
  sleep 2; ID=$(curl -s $M/messages | J "d['messages'][0]['ID']")
  T=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
  curl -s -o /dev/null $H $O -d "{\"token\":\"$T\"}" $A/auth/verify-email
}
echo "--- lịch khởi hành (vé Osaka)"
curl -s $A/products/ve-ha-noi-osaka-khu-hoi/departures > av.json
python3 -c "import json;d=json.load(open('av.json'))['data'];print([(f['label'],f['adult_price'],f['child_price']) for f in d['fares']]);x=d['departures'][0];print(x['depart_date'],x['return_date'],[s['left'] for s in x['seats']], len(d['departures']),'chuyến')"
DEP=$(python3 -c "import json;print(json.load(open('av.json'))['data']['departures'][0]['id'])")
ECO=$(python3 -c "import json;print(json.load(open('av.json'))['data']['fares'][0]['id'])")
BUS=$(python3 -c "import json;print(json.load(open('av.json'))['data']['fares'][1]['id'])")
curl -s $A/products/nuoc-hoa-aviator-edp/departures | J "'hàng hoá:', d['error']['code']"
user a.txt; user b.txt
HOLD() { curl -s -b $1 $O $H -H "Idempotency-Key: $2" -d "{\"departure_id\":\"$DEP\",\"fare_id\":\"$3\",\"adults\":$4,\"children\":$5}" $A/me/bookings; }
echo "--- giữ chỗ"
K=k-$(date +%s%N)
HOLD a.txt $K $ECO 2 1 | J "d['data']['code'], d['data']['status'], d['data']['total'], d['data']['expires_in']" | tee c1.txt
HOLD a.txt $K $ECO 2 1 | J "'gửi lại cùng key:', d['data']['code']"
curl -s $A/products/ve-ha-noi-osaka-khu-hoi/departures | J "'chỗ còn (phổ thông, thương gia):', [x['left'] for x in d['data']['departures'][0]['seats']]"
HOLD a.txt k2-$RANDOM$RANDOM $ECO 0 2 | J "d['error']['code']"
HOLD a.txt k3-$RANDOM$RANDOM $ECO 9 1 | J "d['error']['code']"
echo "--- 2 người tranh 4 ghế thương gia (mỗi người 3)"
HOLD a.txt r1-$RANDOM$RANDOM $BUS 3 0 > r1.json & HOLD b.txt r2-$RANDOM$RANDOM $BUS 3 0 > r2.json & wait
for f in r1.json r2.json; do python3 -c "import json;d=json.load(open('$f'));print(d['data']['code'] if 'data' in d else (d['error']['code'], d['error']['message']))"; done
curl -s $A/products/ve-ha-noi-osaka-khu-hoi/departures | J "'chỗ còn (phổ thông, thương gia):', [x['left'] for x in d['data']['departures'][0]['seats']]"
echo "--- mỗi người tối đa 2 đơn đang giữ (người c)"
user c.txt
for k in 1 2 3; do HOLD c.txt c$k-$RANDOM$RANDOM $ECO 1 0 | J "'c giữ đơn thứ $k:', d['data']['status'] if 'data' in d else d['error']['code']"; done
echo "--- điền hành khách"
C1=$(cut -d' ' -f1 c1.txt)
D=$(date -d "+20 days" +%F)
curl -s -b a.txt $O $H -X PUT -d '{"contact_name":"T","contact_phone":"1","contact_email":"x","passengers":[{"full_name":"An","birth_date":"2030-01-01"}]}' $A/me/bookings/$C1/details | J "d['error']['fields']"
curl -s -b a.txt $O $H -X PUT -d '{"contact_name":"Nguyễn Văn An","contact_phone":"0901 234 567","contact_email":"an@example.com","passengers":[{"full_name":"Nguyễn Văn An","birth_date":"1990-05-20"},{"full_name":"Trần Thị  Đào","birth_date":"1992-03-01"},{"full_name":"nguyễn đức minh","birth_date":"1995-01-01"}]}' $A/me/bookings/$C1/details | J "d['error']['fields']"
curl -s -b a.txt $O $H -X PUT -d '{"contact_name":"Nguyễn Văn An","contact_phone":"0901 234 567","contact_email":"an@example.com","passengers":[{"full_name":"Nguyễn Văn An","birth_date":"1990-05-20"},{"full_name":"Trần Thị  Đào","birth_date":"1992-03-01"},{"full_name":"nguyễn đức minh","birth_date":"2018-01-01"}]}' $A/me/bookings/$C1/details | J "d['data']['status'], [(p['kind'],p['full_name']) for p in d['data']['passengers']]"
curl -s -b b.txt $A/me/bookings/$C1 | J "'người khác xem:', d['error']['code']"
echo "--- huỷ"
curl -s -b a.txt $O -X POST $A/me/bookings/$C1/cancel | J "d['data']['status']"
curl -s -b a.txt $O -X POST $A/me/bookings/$C1/cancel | J "d['error']['code']"
curl -s $A/products/ve-ha-noi-osaka-khu-hoi/departures | J "'chỗ còn sau huỷ:', [x['left'] for x in d['data']['departures'][0]['seats']]"
echo "--- hết hạn (cho đơn thương gia quá hạn, chờ worker)"
PSQL "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE status = 'held' AND fare_label = 'Thương gia'" >/dev/null
for f in r1.json r2.json; do python3 -c "import json;d=json.load(open('$f'));print(d['data']['code'] if 'data' in d else '')"; done | grep BK > held.txt
CB=$(head -1 held.txt); for f in a.txt b.txt; do S=$(curl -s -b $f $A/me/bookings/$CB | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',{}).get('status',''))"); [ -n "$S" ] && echo "API ngay lúc quá hạn: $S"; done
sleep 35
curl -s $A/products/ve-ha-noi-osaka-khu-hoi/departures | J "'chỗ còn sau khi worker chạy:', [x['left'] for x in d['data']['departures'][0]['seats']]"
PSQL "SELECT status FROM bookings WHERE code = '$CB'"
docker compose logs --since 2m worker 2>&1 | grep "trả ghế" | tail -1 | sed 's/.*msg=/msg=/'
rm -f a.txt b.txt c.txt r1.json r2.json c1.txt held.txt av.json
```

Kết quả thật:

```text
--- lịch khởi hành (vé Osaka)
[('Phổ thông', 6900000, 5200000), ('Thương gia', 18900000, 14500000)]
2026-10-31 2026-11-06 [20, 4] 12 chuyến
hàng hoá: product_not_found
--- giữ chỗ
BK-8BM9YEV7 held 19000000 1199
gửi lại cùng key: BK-8BM9YEV7
chỗ còn (phổ thông, thương gia): [17, 4]
invalid_passengers
invalid_passengers
--- 2 người tranh 4 ghế thương gia (mỗi người 3)
BK-4BR9NGSN
('not_enough_seats', 'Hạng Thương gia ngày 31/10/2026 chỉ còn 1 chỗ')
chỗ còn (phổ thông, thương gia): [17, 1]
--- mỗi người tối đa 2 đơn đang giữ (người c)
c giữ đơn thứ 1: held
c giữ đơn thứ 2: held
c giữ đơn thứ 3: too_many_holds
--- điền hành khách
{'contact_email': 'Email không hợp lệ', 'contact_name': 'Họ tên từ 2 đến 100 ký tự', 'contact_phone': 'Số điện thoại Việt Nam không hợp lệ', 'passengers': 'Cần đúng 3 hành khách', 'passengers.0.birth_date': 'Ngày sinh không hợp lệ', 'passengers.0.full_name': 'Họ và tên như trên giấy tờ, VD: NGUYEN VAN AN'}
{'passengers': 'Đơn giữ chỗ cho 2 người lớn, 1 trẻ em (2–11 tuổi tại ngày khởi hành); ngày sinh đã nhập không khớp'}
awaiting_payment [('adult', 'NGUYEN VAN AN'), ('adult', 'TRAN THI DAO'), ('child', 'NGUYEN DUC MINH')]
người khác xem: booking_not_found
--- huỷ
cancelled
booking_not_active
chỗ còn sau huỷ: [18, 1]
--- hết hạn (cho đơn thương gia quá hạn, chờ worker)
API ngay lúc quá hạn: expired
chỗ còn sau khi worker chạy: [18, 4]
expired
msg="đã trả ghế đơn giữ chỗ quá hạn" dong_ghe=1
```

Đọc kết quả:

- **Lịch**: 12 chuyến đi Osaka, mỗi chuyến về sau 6 ngày; hạng Phổ thông 20 chỗ, Thương gia 4 chỗ.
- **Giữ chỗ 2 người lớn + 1 trẻ em**: 6.900.000 × 2 + 5.200.000 = 19.000.000; còn 1199 giây (gần 20 phút).
  Gửi lại cùng key: cùng mã đơn, chỗ chỉ trừ một lần (20 → 17).
- **0 người lớn, hay 10 khách**: `invalid_passengers`.
- **Hai người tranh 4 ghế Thương gia, mỗi người 3, chạy song song**: một người giữ được, người kia
  `not_enough_seats` "chỉ còn 1 chỗ". Không bao giờ thành −2.
- **Người c giữ đơn thứ 3**: `too_many_holds`.
- **Hành khách**: dữ liệu sai báo lỗi từng ô (`passengers.0.full_name`…); ba người lớn trong đơn 2 người lớn
  + 1 trẻ em bị từ chối; sửa ngày sinh bé thành 2018 thì được, tên thành `TRAN THI DAO`, `NGUYEN DUC MINH`.
- **Huỷ**: trả lại 3 chỗ Phổ thông; còn 18 = 20 − 2 chỗ của hai đơn người c đang giữ. Huỷ lần hai
  báo `booking_not_active`.
- **Hết hạn**: ngay khi quá giờ, API đã báo `expired` dù worker chưa chạy; sau tối đa 30 giây worker đổi
  trạng thái trong database và trả 3 ghế Thương gia (1 → 4), log `đã trả ghế đơn giữ chỗ quá hạn`.

Dọn dữ liệu thử:

```sql
-- make psql
DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'thu8-%');
DELETE FROM users WHERE email LIKE 'thu8-%';
-- Tính lại số chỗ đã lấy từ các đơn còn hiệu lực
UPDATE departure_seats s SET taken = COALESCE((
  SELECT sum(adults + children) FROM bookings b
  WHERE b.departure_id = s.departure_id AND b.fare_id = s.fare_id
    AND b.status IN ('held', 'awaiting_payment', 'confirmed')), 0);
```

```bash
git add . && git commit -m "Đặt vé, tour: lịch khởi hành, giữ chỗ (backend)"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đăng ký tài khoản thử trả `429` sau vài lần chạy script | Giới hạn 10 lần đăng ký / giờ / IP (bài 4.04) đang chạy đúng. Khi dev: `docker compose exec redis redis-cli -a airlife --no-auth-warning --scan --pattern 'auth:register:*'` rồi `DEL` từng khoá |
| Đơn quá hạn nhưng ghế không về | Worker chưa chạy lại sau khi sửa code: `make restart s=worker`, xem `make logs s=worker` |
| Xoá đơn thử bằng SQL xong số chỗ còn sai | Xoá đơn không trả ghế; chạy câu tính lại `taken` ở trên |
