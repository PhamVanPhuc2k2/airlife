package news

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/news/categories
func (h *Handler) Categories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.svc.Categories(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, cats)
}

// GET /api/v1/news?category=kham-pha&cursor=…&limit=12
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, err := h.svc.List(r.Context(), q.Get("category"), q.Get("cursor"), limit)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /api/v1/news/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, a)
}

// GET /api/v1/news/{slug}/related
func (h *Handler) Related(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Related(r.Context(), chi.URLParam(r, "slug"), 4)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, items)
}
