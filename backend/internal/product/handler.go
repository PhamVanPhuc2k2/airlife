package product

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /products?category=kinh-doanh&tag=dac-san&channel=…&sort=new|bestseller&cursor=…&limit=24
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, err := h.svc.List(r.Context(), ListParams{
		Category: q.Get("category"), Tag: q.Get("tag"), Channel: q.Get("channel"),
		Sort: q.Get("sort"), Cursor: q.Get("cursor"), Limit: limit,
	})
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /products/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	d, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, d)
}

// GET /media/{slug}/products
func (h *Handler) ByMedia(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.ByMedia(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, items)
}

// PUT /me/favorites/{slug}
func (h *Handler) AddFavorite(w http.ResponseWriter, r *http.Request) { h.setFavorite(w, r, true) }

// DELETE /me/favorites/{slug}
func (h *Handler) RemoveFavorite(w http.ResponseWriter, r *http.Request) { h.setFavorite(w, r, false) }

func (h *Handler) setFavorite(w http.ResponseWriter, r *http.Request, fav bool) {
	a, _ := auth.ActorFrom(r.Context())
	if err := h.svc.SetFavorite(r.Context(), a.UserID, chi.URLParam(r, "slug"), fav); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// GET /me/favorites?cursor=…
func (h *Handler) Favorites(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.ActorFrom(r.Context())
	page, err := h.svc.Favorites(r.Context(), a.UserID, r.URL.Query().Get("cursor"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /me/products/{slug}: trạng thái của sản phẩm với người đang xem (đã yêu thích chưa)
func (h *Handler) State(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.ActorFrom(r.Context())
	fav, err := h.svc.IsFavorite(r.Context(), a.UserID, chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, map[string]bool{"favorite": fav})
}
