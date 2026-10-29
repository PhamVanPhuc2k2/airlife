// Package database mở pool kết nối PostgreSQL bằng pgx.
//
// pgxpool giữ sẵn nhiều kết nối và cho mượn theo từng truy vấn, an toàn khi nhiều
// goroutine (nhiều request) dùng cùng lúc. Cả ứng dụng chỉ tạo MỘT pool.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPostgres(ctx context.Context, url string, maxConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		// Không bọc url vào lỗi: url chứa mật khẩu, lỗi này sẽ được in ra log.
		return nil, fmt.Errorf("POSTGRES_URL sai định dạng: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("tạo pool postgres: %w", err)
	}

	// NewWithConfig không kết nối thật cho tới truy vấn đầu tiên. Ping ngay để
	// sai mật khẩu / DB chưa chạy thì báo lỗi lúc khởi động.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}
