// Package cache mở kết nối Redis bằng go-redis.
//
// Redis dùng cho: cache API, đếm lượt xem, phiên đăng nhập, rate limit, lock giữ chỗ.
// redis.Client cũng là một pool kết nối, an toàn khi dùng chung giữa các goroutine.
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func NewRedis(ctx context.Context, addr, password string, db int) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("ping redis %s: %w", addr, err)
	}
	return rdb, nil
}
