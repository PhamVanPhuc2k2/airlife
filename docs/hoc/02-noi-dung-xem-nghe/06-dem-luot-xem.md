# Bài 2.06: Đếm lượt xem bằng Redis, gom về PostgreSQL ở worker

> [← Bài trước](05-module-media.md) · [Mục lục](../README.md) · [Bài sau →](07-trang-chu-va-noi-day.md)

## Mục tiêu

`POST /api/v1/media/{slug}/views` ghi nhận lượt xem vào Redis (mỗi IP một lượt / 30 phút); worker
30 giây một lần cộng dồn vào `media.view_count`.

## Bạn sẽ học

- Vì sao **không** `UPDATE ... SET view_count = view_count + 1` cho mỗi lượt xem.
- Lệnh Redis: `SET NX EX`, `INCR`, `SCAN`, `GETDEL`, và vì sao cần **nguyên tử**.
- Job định kỳ bằng `time.Ticker` trong worker, và tắt êm có lần chạy cuối.

## Viết code

### Bước 1: Vấn đề

Một video hot có 500 người bấm xem trong 1 giây = 500 câu `UPDATE` vào **cùng một dòng**. PostgreSQL
phải khoá dòng đó cho từng câu, các câu xếp hàng chờ nhau, API chậm theo. Giải pháp: đếm trong Redis
(INCR là thao tác trong bộ nhớ, không khoá gì), rồi định kỳ cộng dồn: 500 lượt xem = **1** câu UPDATE.

Đánh đổi: số lượt xem trên trang chậm tối đa ~30 giây. Với lượt xem thì chấp nhận được; với tiền
(đơn hàng, thanh toán) thì không bao giờ làm kiểu này.

### Bước 2: `backend/internal/media/views.go`

```go
package media

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Đếm lượt xem.
//
// Nếu mỗi lượt xem là một câu UPDATE media SET view_count = view_count + 1, video hot sẽ
// có hàng trăm câu UPDATE cùng lúc tranh nhau khoá MỘT dòng trong PostgreSQL. Thay vào đó:
//  1. API: tăng bộ đếm trong Redis (INCR rất nhanh, không khoá gì).
//  2. Worker: cứ vài chục giây gom các bộ đếm, cộng vào PostgreSQL một lần cho mỗi media.
//
// Mỗi IP chỉ được tính một lượt cho một media trong 30 phút, để F5 liên tục không thổi phồng số.
const (
	viewDedupTTL   = 30 * time.Minute
	pendingPrefix  = "views:pending:"
	dedupKeyPrefix = "views:seen:"
)

// RecordView ghi nhận một lượt xem từ ip.
func (s *Service) RecordView(ctx context.Context, slug, ip string) error {
	if !slugRe.MatchString(slug) {
		return errNotFound
	}
	id, err := s.repo.IDBySlug(ctx, slug)
	if err != nil {
		return err
	}
	// SET NX: chỉ đặt được nếu khoá CHƯA có. Đặt được = lần đầu IP này xem trong 30 phút.
	first, err := s.rdb.SetNX(ctx, dedupKeyPrefix+id.String()+":"+ip, 1, viewDedupTTL).Result()
	if err != nil {
		return err
	}
	if !first {
		return nil
	}
	return s.rdb.Incr(ctx, pendingPrefix+id.String()).Err()
}

// FlushViews chuyển các bộ đếm đang chờ trong Redis vào PostgreSQL. Worker gọi định kỳ.
// Trả về số media đã cập nhật.
func (s *Service) FlushViews(ctx context.Context) (int, error) {
	n := 0
	// SCAN duyệt từng nhóm khoá, không chặn Redis như lệnh KEYS (KEYS duyệt hết một lượt,
	// Redis đứng hình suốt lúc đó nếu có hàng triệu khoá).
	iter := s.rdb.Scan(ctx, 0, pendingPrefix+"*", 200).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		id, err := uuid.Parse(strings.TrimPrefix(key, pendingPrefix))
		if err != nil {
			slog.WarnContext(ctx, "khoá lượt xem sai định dạng", "key", key)
			continue
		}
		// GETDEL: lấy giá trị và xoá trong MỘT lệnh. Nếu GET rồi DEL riêng, lượt xem nào
		// INCR chen vào giữa hai lệnh sẽ bị xoá mất.
		views, err := s.rdb.GetDel(ctx, key).Int64()
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			return n, err
		}
		if err := s.repo.AddViews(ctx, id, views); err != nil {
			// Ghi DB lỗi: trả số đếm lại Redis để lần sau thử tiếp, không mất lượt xem.
			if rerr := s.rdb.IncrBy(ctx, key, views).Err(); rerr != nil {
				return n, fmt.Errorf("cộng lượt xem lỗi (%w), trả lại Redis cũng lỗi: %w", err, rerr)
			}
			return n, err
		}
		n++
	}
	return n, iter.Err()
}
```

- **`SetNX(..., 30*time.Minute)`**: đặt khoá `views:seen:<media>:<ip>` **chỉ khi chưa có**, tự hết hạn
  sau 30 phút. Trả `true` = lần đầu → tính lượt.
- **`SCAN`, không phải `KEYS`**: `KEYS views:*` duyệt toàn bộ Redis trong một lệnh; Redis xử lý từng
  lệnh một, nên trong lúc đó mọi request khác (cache, phiên đăng nhập) đều đứng chờ.
- **`GETDEL`**: đọc và xoá trong **một** lệnh. Nếu tách `GET` rồi `DEL`, lượt `INCR` nào chen vào giữa
  hai lệnh sẽ bị xoá mất (race condition).
- **Ghi DB lỗi thì trả số đếm lại Redis** (`IncrBy`): không mất lượt xem.

### Bước 3: Vòng gom trong worker

`backend/cmd/worker/main.go` bản đầy đủ:

```go
// Command worker chạy các job nền nhận từ RabbitMQ: gửi email, kiểm tra video YouTube,
// flush lượt xem từ Redis về PostgreSQL…
//
// Bản khởi đầu chỉ mở kết nối và chờ tín hiệu tắt. Consumer đầu tiên (gửi email)
// được thêm ở phần đăng nhập. File này lớn dần qua các phần của khoá học.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
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

	// Job nền chạy trong goroutine riêng. Khi run() kết thúc (tắt worker, hoặc mất RabbitMQ),
	// defer dưới đây huỷ vòng lặp rồi CHỜ nó xong. defer chạy theo thứ tự ngược, nên defer này
	// (khai báo sau cùng) chạy TRƯỚC các defer đóng PostgreSQL, Redis ở trên: lần gom cuối
	// vẫn còn kết nối để dùng.
	mediaSvc := media.NewService(media.NewRepository(db.New(pool)), rdb)
	loopCtx, stopLoop := context.WithCancel(ctx)
	loopDone := make(chan struct{})
	go func() {
		defer close(loopDone)
		flushViewsLoop(loopCtx, log, mediaSvc)
	}()
	defer func() {
		stopLoop()
		<-loopDone
	}()

	// Mất kết nối RabbitMQ thì thoát với lỗi để Docker khởi động lại worker
	// (restart: unless-stopped). Tự kết nối lại sẽ làm ở phần hàng đợi.
	closed := mq.NotifyClose(make(chan *amqp.Error, 1))
	select {
	case <-ctx.Done():
		log.Info("worker đã tắt")
		return nil
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
```

- **`time.NewTicker(30 * time.Second)`** + `select`: chạy mỗi 30 giây cho tới khi `ctx` bị huỷ.
- **Lần gom cuối khi tắt** dùng `context.Background()` mới (có timeout 5 giây), vì `ctx` cũ đã huỷ:
  truy vấn chạy bằng context đã huỷ sẽ lỗi ngay.
- **Thứ tự `defer`**: `defer` chạy **ngược** thứ tự khai báo. Defer "huỷ vòng lặp và chờ" khai báo
  **sau** các defer đóng PostgreSQL/Redis, nên chạy **trước** chúng: lần gom cuối vẫn còn kết nối.
  Lúc đầu dự án viết `go flushViewsLoop(ctx, ...)` rồi để đó: khi tắt, `run()` trả về và đóng database
  trong lúc goroutine đang gom, lần gom cuối sẽ lỗi.
- Biến `db` cũ đổi tên thành `pool`, vì `db` giờ là tên gói sqlc (`db.New(pool)`).

## Kiểm tra

Sau bài 2.07 (khi route đã được gắn):

```bash
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:8080/api/v1/media/ghe-12a/views; done
# 204 204 204
docker compose exec redis redis-cli -a airlife --no-auth-warning --scan --pattern 'views:*'
# views:pending:<id>      ← bộ đếm chờ gom (giá trị 1, không phải 3)
# views:seen:<id>:<ip>    ← đánh dấu IP này đã xem
```

Chờ tối đa 30 giây:

```bash
docker compose logs worker | grep "gom"      # msg="đã gom lượt xem" media=1
```

`view_count` của `ghe-12a` tăng đúng **1**, dù gọi 3 lần.

```bash
git add . && git commit -m "Đếm lượt xem bằng Redis, gom ở worker"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `ERR unknown command 'GETDEL'` | Redis dưới 6.2. Dự án dùng Redis 8 |
| Lượt xem không bao giờ vào DB | Worker chưa build lại: `make restart s=worker`, xem `make logs s=worker` |
| Mọi khách bị tính là một IP | IP thật chưa đúng (bài 0.07): kiểm tra `HTTP_TRUSTED_PROXIES` khi chạy sau nginx/Cloudflare |
