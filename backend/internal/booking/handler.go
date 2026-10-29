package booking

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

func (h *Handler) reply(w http.ResponseWriter, r *http.Request, data any, err error) {
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, data)
}

// GET /products/{slug}/departures: hạng dịch vụ, lịch khởi hành, số chỗ còn (công khai)
func (h *Handler) Availability(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Availability(r.Context(), chi.URLParam(r, "slug"))
	h.reply(w, r, a, err)
}

// POST /me/bookings  (header Idempotency-Key)  {"departure_id", "fare_id", "adults", "children"}
func (h *Handler) Hold(w http.ResponseWriter, r *http.Request) {
	var in HoldInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	b, err := h.svc.Hold(r.Context(), userID(r), r.Header.Get("Idempotency-Key"), in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, b)
}

// PUT /me/bookings/{code}/details  {"contact_name", "contact_phone", "contact_email", "passengers": [...]}
func (h *Handler) SetDetails(w http.ResponseWriter, r *http.Request) {
	var in DetailsInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	b, err := h.svc.SetDetails(r.Context(), userID(r), chi.URLParam(r, "code"), in)
	h.reply(w, r, b, err)
}

// POST /me/bookings/{code}/cancel
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	b, err := h.svc.Cancel(r.Context(), userID(r), chi.URLParam(r, "code"))
	h.reply(w, r, b, err)
}

// GET /me/bookings/{code}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	b, err := h.svc.Get(r.Context(), userID(r), chi.URLParam(r, "code"))
	h.reply(w, r, b, err)
}

// GET /me/bookings?cursor=…
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.List(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	h.reply(w, r, p, err)
}
