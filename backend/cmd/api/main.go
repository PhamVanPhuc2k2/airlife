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
