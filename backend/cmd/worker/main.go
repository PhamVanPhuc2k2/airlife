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
