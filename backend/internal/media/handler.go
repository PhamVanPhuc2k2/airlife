package media

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc      *Service
	log      *slog.Logger
	clientIP func(*http.Request) string
}

// clientIP: hàm lấy IP thật của khách (server.ClientIP). Truyền vào thay vì import gói server,
// để media không phụ thuộc ngược lên server.
func NewHandler(svc *Service, log *slog.Logger, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, clientIP: clientIP}
}

// GET /api/v1/media?category=xem&tag=hanh-dong&sort=new|popular&lineup=2026-10&cursor=…&limit=24
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit")) // sai hoặc thiếu → 0 → service dùng mặc định
	page, err := h.svc.List(r.Context(), ListParams{
		Category: q.Get("category"),
		Tag:      q.Get("tag"),
		Sort:     q.Get("sort"),
		Lineup:   q.Get("lineup"),
		Cursor:   q.Get("cursor"),
		Limit:    limit,
	})
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /api/v1/media/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	d, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, d)
}

// GET /api/v1/media/{slug}/related
func (h *Handler) Related(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Related(r.Context(), chi.URLParam(r, "slug"), 12)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, items)
}

// POST /api/v1/media/{slug}/views — frontend gọi khi bắt đầu phát.
func (h *Handler) RecordView(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.RecordView(r.Context(), chi.URLParam(r, "slug"), h.clientIP(r)); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// GET /api/v1/lineup/months — các tháng có line-up phim (trang Mới tải, tab Line-up)
func (h *Handler) LineupMonths(w http.ResponseWriter, r *http.Request) {
	months, err := h.svc.LineupMonths(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, months)
}
