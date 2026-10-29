// Package home: dữ liệu trang chủ trong MỘT lần gọi API (thay vì frontend gọi 4–5 API).
//
// Bố cục theo bản vẽ tay của mockup:
//
//	┌ 3 ô bên trái ┐┌──── khối nổi bật ────┐┌ bình luận nổi bật ┐
//	└──────────────┘└──────────────────────┘└─────────────────────┘
//	[ hàng 4 thẻ xem nhiều ]
//	[ Nghe nhiều ] [ Kinh doanh (Phần 07) ] [ Tiện ích (Phần 10) ]
package home

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Trang chủ là trang nhiều người mở nhất: cache 60 giây. Nội dung mới đăng chậm nhất
// 1 phút mới lên trang chủ, đổi lại database gần như không phải làm gì cho trang này.
const cacheTTL = 60 * time.Second

type Home struct {
	Featured  *media.Card  `json:"featured"`
	Latest    []media.Card `json:"latest"`     // 3 ô bên trái: phim mới
	Trending  []media.Card `json:"trending"`   // hàng 4 thẻ: xem nhiều
	TopListen []media.Card `json:"top_listen"` // khối "Nghe nhiều"
	// Cột "Bình luận nổi bật", hai tab: Hay (nhiều thích), Nhiều (nhiều trả lời)
	HotComments struct {
		Top     []comment.HotComment `json:"top"`
		Replied []comment.HotComment `json:"replied"`
	} `json:"hot_comments"`
}

type Service struct {
	media    *media.Service // dùng service của module khác, không gọi thẳng repository của nó
	comments *comment.Service
	rdb      *redis.Client
}

func NewService(m *media.Service, c *comment.Service, rdb *redis.Client) *Service {
	return &Service{media: m, comments: c, rdb: rdb}
}

func (s *Service) Get(ctx context.Context) (Home, error) {
	return cache.Remember(ctx, s.rdb, "cache:home", cacheTTL, s.load)
}

func (s *Service) load(ctx context.Context) (Home, error) {
	var h Home

	featured, err := s.media.Featured(ctx, 1)
	if err != nil {
		return h, err
	}
	if len(featured) > 0 {
		h.Featured = &featured[0]
	}

	latest, err := s.media.List(ctx, media.ListParams{Category: "xem", Sort: "new", Limit: 4})
	if err != nil {
		return h, err
	}
	h.Latest = excludeFeatured(latest.Items, h.Featured, 3)

	trending, err := s.media.List(ctx, media.ListParams{Category: "xem", Sort: "popular", Limit: 8})
	if err != nil {
		return h, err
	}
	// Không lặp lại phim đã có ở khối nổi bật và 3 ô bên trái
	shown := map[string]bool{}
	if h.Featured != nil {
		shown[h.Featured.Slug] = true
	}
	for _, c := range h.Latest {
		shown[c.Slug] = true
	}
	h.Trending = make([]media.Card, 0, 4)
	for _, c := range trending.Items {
		if !shown[c.Slug] && len(h.Trending) < 4 {
			h.Trending = append(h.Trending, c)
		}
	}

	listen, err := s.media.List(ctx, media.ListParams{Category: "nghe", Sort: "popular", Limit: 5})
	if err != nil {
		return h, err
	}
	h.TopListen = listen.Items

	if h.HotComments.Top, err = s.comments.Hot(ctx, false, 5); err != nil {
		return h, err
	}
	if h.HotComments.Replied, err = s.comments.Hot(ctx, true, 5); err != nil {
		return h, err
	}
	return h, nil
}

func excludeFeatured(items []media.Card, featured *media.Card, n int) []media.Card {
	out := make([]media.Card, 0, n)
	for _, c := range items {
		if featured != nil && c.ID == featured.ID {
			continue
		}
		if len(out) == n {
			break
		}
		out = append(out, c)
	}
	return out
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/home
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	data, err := h.svc.Get(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, data)
}
