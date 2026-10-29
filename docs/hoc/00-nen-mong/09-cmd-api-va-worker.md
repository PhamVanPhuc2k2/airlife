# Bài 0.09: `cmd/api` và `cmd/worker`: nối dây và tắt êm

> [← Bài trước](08-router-va-health.md) · [Mục lục](../README.md) · [Bài sau →](10-docker-va-air.md)

## Mục tiêu

Hai chương trình chạy được: API trả lời `/healthz`, `/readyz`, `/api/v1/ping`; worker kết nối
đủ hạ tầng và chờ. Cả hai tắt êm khi nhấn Ctrl+C.

## Bạn sẽ học

- `main` chỉ **nối dây**: đọc config → mở kết nối → dựng server → chờ tín hiệu tắt.
- Mẫu `main()` gọi `run() error`: để `defer` đóng kết nối luôn được chạy.
- **Graceful shutdown**: ngừng nhận request mới, chờ request đang chạy xong rồi mới tắt.
- Bẫy "interface chứa con trỏ nil" của Go.

## Viết code

### Bước 1: `cmd/api/main.go`

```go
// Command api chạy HTTP server của Airlife.
//
// main chỉ làm việc "nối dây": đọc config, mở kết nối, dựng server, chờ tín hiệu tắt.
// Không có nghiệp vụ nào ở đây. File này lớn dần qua các phần của khoá học.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/server"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
)

func main() {
	// Tách run() ra để dùng được `return err` và để các defer (đóng kết nối)
	// chạy trước khi os.Exit. os.Exit bỏ qua mọi defer.
	if err := run(); err != nil {
		slog.Error("api dừng do lỗi", "err", err)
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

	// ctx bị huỷ khi nhận Ctrl+C (SIGINT) hoặc `docker stop` (SIGTERM).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.NewPostgres(ctx, cfg.Postgres.URL, cfg.Postgres.MaxConns)
	if err != nil {
		return err
	}
	defer db.Close()

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

	srv := server.New(server.Deps{Config: cfg, Log: log, DB: db, Redis: rdb, RabbitMQ: mq})
	handler, err := srv.Handler()
	if err != nil {
		return err
	}

	httpSrv := &http.Server{
		Addr:              cfg.HTTP.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second, // chặn kiểu tấn công gửi header thật chậm (Slowloris)
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		// Dài hơn middleware.Timeout một chút để handler kịp trả 504 thay vì bị cắt ngang.
		WriteTimeout: cfg.HTTP.WriteTimeout + 5*time.Second,
		IdleTimeout:  60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("api đang chạy", "addr", cfg.HTTP.Addr, "env", cfg.App.Env)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err // không mở được cổng (đã có tiến trình khác dùng…)
	case <-ctx.Done():
	}

	// Graceful shutdown: ngừng nhận request mới, chờ request đang chạy xong
	// (tối đa HTTP_SHUTDOWN_TIMEOUT) rồi mới đóng kết nối DB, Redis, RabbitMQ.
	log.Info("đang tắt api…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	log.Info("api đã tắt")
	return nil
}
```

Điểm chính:

- **`main` → `run`**: `os.Exit` thoát ngay, **bỏ qua mọi `defer`**. Nếu gọi `os.Exit(1)` ngay
  trong `main` sau khi đã mở DB thì kết nối không được đóng tử tế. Đưa hết vào `run()`, trả lỗi
  về `main`, các `defer` chạy xong rồi mới `os.Exit`.
- **`signal.NotifyContext`**: `ctx` bị huỷ khi nhận Ctrl+C (SIGINT) hoặc `docker stop` (SIGTERM).
- **`defer db.Close()`** chạy theo thứ tự ngược: RabbitMQ đóng trước, rồi Redis, rồi PostgreSQL.
- **`defer func() { _ = rdb.Close() }()`**: `Close()` trả về lỗi, linter `errcheck` bắt phải xử lý.
  Lúc tắt thì không làm gì được với lỗi đó, nên bỏ qua **có chủ đích** bằng `_ =`.
- **`ReadHeaderTimeout`**: chặn kiểu tấn công Slowloris: mở thật nhiều kết nối, gửi header thật
  chậm để giữ chỗ, server hết kết nối cho khách thật.
- **`ListenAndServe` chạy trong goroutine** vì nó chặn mãi; `main` cần rảnh để chờ tín hiệu tắt.
  `select` chờ một trong hai: server lỗi (cổng bị chiếm) hoặc có tín hiệu tắt.
- **`http.ErrServerClosed`** là lỗi "bình thường" khi gọi `Shutdown`, không phải lỗi thật.

### Bước 2: `cmd/worker/main.go`

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

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
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

	db, err := database.NewPostgres(ctx, cfg.Postgres.URL, cfg.Postgres.MaxConns)
	if err != nil {
		return err
	}
	defer db.Close()

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
```

**Bẫy interface nil**: `NotifyClose` gửi `*amqp.Error`. Nếu viết `return amqpErr` khi
`amqpErr` là con trỏ nil, Go đóng gói nó vào interface `error` thành một giá trị **khác nil**
(interface có kiểu `*amqp.Error`, giá trị nil). Bên gọi `if err != nil` ra `true`, in ra `<nil>`.
Phải kiểm tra `amqpErr == nil` trước khi trả.

## Kiểm tra

Chạy thật với đủ hạ tầng ở bài 0.10 (trong Docker). Ở bài này kiểm tra build và các lỗi
config, chỉ cần Go trên máy:

```bash
cd backend && go build ./... && go vet ./...

go run ./cmd/api
# ERROR api dừng do lỗi err="thiếu biến môi trường bắt buộc: POSTGRES_URL, RABBITMQ_URL, REDIS_ADDR"
```

`backend/.env` không chứa địa chỉ hạ tầng (Docker đặt chúng), nên báo thiếu là đúng. Thử
biến môi trường ghi đè `.env`:

```bash
APP_ENV=prod POSTGRES_URL=x REDIS_ADDR=x RABBITMQ_URL=x go run ./cmd/api
# ERROR api dừng do lỗi err="APP_ENV không hợp lệ: \"prod\" (chỉ nhận development, staging, production)"
```

Đủ biến nhưng hạ tầng chưa chạy thì dừng ngay ở bước ping, không treo:

```bash
POSTGRES_URL=postgres://a:b@localhost:1/x REDIS_ADDR=x RABBITMQ_URL=x go run ./cmd/api
# ERROR api dừng do lỗi err="ping postgres: failed to connect to ... connection refused"
```

```bash
git add . && git commit -m "cmd/api và cmd/worker bản khởi đầu"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `bind: address already in use` | Còn một API khác đang chạy ở cổng 8080: `lsof -i :8080` rồi tắt nó, hoặc đổi `HTTP_ADDR` |
| `.env` không được đọc | Phải chạy từ thư mục `backend/`; `.env` được tìm theo thư mục hiện tại (trong Docker là `/app`) |
| Ctrl+C mà API không tắt | Có request đang chạy; API chờ tối đa `HTTP_SHUTDOWN_TIMEOUT` (15s) |
