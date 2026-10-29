package cart

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

type itemsInput struct {
	Items []Item `json:"items"`
}

func (h *Handler) reply(w http.ResponseWriter, r *http.Request, c Cart, err error) {
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, c)
}

func userID(r *http.Request) uuid.UUID {
	a, _ := auth.ActorFrom(r.Context())
	return a.UserID
}

// POST /cart/preview  {"items": [{"variant_id": "…", "quantity": 2}]}  (giỏ của khách)
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	var in itemsInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	c, err := h.svc.Preview(r.Context(), in.Items)
	h.reply(w, r, c, err)
}

// GET /me/cart
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	c, err := h.svc.Get(r.Context(), userID(r))
	h.reply(w, r, c, err)
}

// PUT /me/cart/items/{variantID}  {"quantity": 2}
func (h *Handler) Set(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "variantID"))
	if err != nil {
		response.Error(w, r, h.log, errVariantNotFound)
		return
	}
	var in struct {
		Quantity int32 `json:"quantity"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	c, err := h.svc.Set(r.Context(), userID(r), id, in.Quantity)
	h.reply(w, r, c, err)
}

// DELETE /me/cart/items/{variantID}
func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "variantID"))
	if err != nil {
		response.Error(w, r, h.log, errVariantNotFound)
		return
	}
	c, err := h.svc.Remove(r.Context(), userID(r), id)
	h.reply(w, r, c, err)
}

// POST /me/cart/merge  {"items": [...]}  (gộp giỏ của khách khi đăng nhập)
func (h *Handler) Merge(w http.ResponseWriter, r *http.Request) {
	var in itemsInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	c, err := h.svc.Merge(r.Context(), userID(r), in.Items)
	h.reply(w, r, c, err)
}
