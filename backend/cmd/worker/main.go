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
