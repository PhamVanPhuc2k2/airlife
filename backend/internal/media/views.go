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
