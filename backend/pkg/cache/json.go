package cache

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Remember là mẫu "cache-aside": tìm trong Redis trước; không có thì gọi load (đọc database),
// lưu kết quả vào Redis với thời hạn ttl, rồi trả về.
//
// Redis lỗi (sập, mất kết nối) thì KHÔNG làm hỏng request: ghi log rồi đọc thẳng database.
// Cache chỉ để nhanh hơn, không được là điểm chết của hệ thống.
func Remember[T any](
	ctx context.Context, rdb *redis.Client, key string, ttl time.Duration,
	load func(context.Context) (T, error),
) (T, error) {
	var v T
	b, err := rdb.Get(ctx, key).Bytes()
	switch {
	case err == nil:
		if json.Unmarshal(b, &v) == nil {
			return v, nil
		}
		// Dữ liệu cache hỏng (đổi cấu trúc struct sau khi deploy…): bỏ qua, đọc lại.
	case !errors.Is(err, redis.Nil): // redis.Nil = không có khoá, là bình thường
		slog.WarnContext(ctx, "đọc cache lỗi", "key", key, "err", err)
	}

	v, err = load(ctx)
	if err != nil {
		return v, err
	}
	if b, err := json.Marshal(v); err == nil {
		if err := rdb.Set(ctx, key, b, ttl).Err(); err != nil {
			slog.WarnContext(ctx, "ghi cache lỗi", "key", key, "err", err)
		}
	}
	return v, nil
}
