package order

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

func userID(r *http.Request) uuid.UUID {
	a, _ := auth.ActorFrom(r.Context())
	return a.UserID
}

// POST /me/orders  (header Idempotency-Key)  body: CheckoutInput
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	var in CheckoutInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	o, err := h.svc.Checkout(r.Context(), userID(r), r.Header.Get("Idempotency-Key"), in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, o)
}

// GET /me/orders?cursor=…
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.List(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, p)
}

// GET /me/orders/{code}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	o, err := h.svc.Get(r.Context(), userID(r), chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, o)
}

// POST /me/orders/{code}/cancel
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	o, err := h.svc.Cancel(r.Context(), userID(r), chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, o)
}
