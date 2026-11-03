// Package weather: thời tiết tại các sân bay (Phần 10), lấy từ Open-Meteo và cache trong Redis.
//
// Hai lớp cache:
//   - tươi, 30 phút: trong thời gian này không gọi Open-Meteo lần nào, bao nhiêu người xem cũng vậy;
//   - cũ, 24 giờ: Open-Meteo lỗi hay chậm thì trả dữ liệu cũ kèm "stale": true, tốt hơn là báo lỗi.
package weather

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/flight"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
	pkgweather "github.com/PhamVanPhuc2k2/airlife/backend/pkg/weather"
)

const (
	freshKey = "cache:weather:fresh"
	staleKey = "cache:weather:stale"
	freshTTL = 30 * time.Minute
	staleTTL = 24 * time.Hour
)

type Airport struct {
	Code string `json:"code"`
	City string `json:"city"`
	pkgweather.Reading
}

type Report struct {
	UpdatedAt time.Time `json:"updated_at"`
	// Stale = true: Open-Meteo đang lỗi, đây là dữ liệu đã lưu trước đó
	Stale    bool      `json:"stale"`
	Airports []Airport `json:"airports"`
}

type Service struct {
	flights *flight.Service
	client  *pkgweather.Client
	rdb     *redis.Client
	log     *slog.Logger
	group   singleflight.Group
	now     func() time.Time
}

func NewService(flights *flight.Service, client *pkgweather.Client, rdb *redis.Client, log *slog.Logger) *Service {
	return &Service{flights: flights, client: client, rdb: rdb, log: log, now: time.Now}
}

func (s *Service) Get(ctx context.Context) (Report, error) {
	if rep, ok := s.read(ctx, freshKey); ok {
		return rep, nil
	}
	// Nhiều request cùng lúc thấy cache hết hạn thì chỉ MỘT request gọi Open-Meteo, những request còn
	// lại chờ và nhận cùng kết quả (singleflight). Không có nó, cache hết hạn đúng lúc đông người xem
	// sẽ bắn hàng loạt request ra ngoài.
	v, err, _ := s.group.Do("refresh", func() (any, error) {
		// Context của request đầu có thể bị huỷ giữa chừng (người dùng đóng tab) làm hỏng kết quả
		// của những request đang chờ: dùng context riêng có thời hạn.
		c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		return s.refresh(c)
	})
	if err == nil {
		return v.(Report), nil
	}

	s.log.WarnContext(ctx, "lấy thời tiết lỗi, dùng dữ liệu cũ nếu có", "err", err)
	if rep, ok := s.read(ctx, staleKey); ok {
		rep.Stale = true
		return rep, nil
	}
	return Report{}, apperr.Unavailable("weather_unavailable", "Chưa lấy được thời tiết, vui lòng thử lại sau").WithErr(err)
}

func (s *Service) refresh(ctx context.Context) (Report, error) {
	aps, err := s.flights.Airports(ctx)
	if err != nil {
		return Report{}, err
	}
	points := make([]pkgweather.Point, len(aps))
	for i, a := range aps {
		points[i] = pkgweather.Point{Lat: a.Lat, Lon: a.Lon}
	}
	readings, err := s.client.Fetch(ctx, points)
	if err != nil {
		return Report{}, err
	}
	rep := Report{UpdatedAt: s.now().UTC(), Airports: make([]Airport, len(aps))}
	for i, a := range aps {
		rep.Airports[i] = Airport{Code: a.Code, City: a.City, Reading: readings[i]}
	}
	if b, err := json.Marshal(rep); err == nil {
		pipe := s.rdb.Pipeline()
		pipe.Set(ctx, freshKey, b, freshTTL)
		pipe.Set(ctx, staleKey, b, staleTTL)
		if _, err := pipe.Exec(ctx); err != nil {
			s.log.WarnContext(ctx, "ghi cache thời tiết lỗi", "err", err)
		}
	}
	return rep, nil
}

func (s *Service) read(ctx context.Context, key string) (Report, bool) {
	b, err := s.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			s.log.WarnContext(ctx, "đọc cache thời tiết lỗi", "key", key, "err", err)
		}
		return Report{}, false
	}
	var rep Report
	if json.Unmarshal(b, &rep) != nil {
		return Report{}, false
	}
	return rep, true
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /weather — thời tiết hiện tại tại mọi sân bay
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	rep, err := h.svc.Get(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, rep)
}
