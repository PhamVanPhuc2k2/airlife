package flight

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
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

func (h *Handler) reply(w http.ResponseWriter, r *http.Request, data any, err error) {
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, data)
}

func userID(r *http.Request) uuid.UUID {
	a, _ := auth.ActorFrom(r.Context())
	return a.UserID
}

// GET /flights?q=VN220 — bảng chuyến bay và vị trí máy bay đang bay (bản đồ Flightradar)
func (h *Handler) Board(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) > 40 {
		response.Error(w, r, h.log, apperr.Invalid("invalid_query", "Từ khoá quá dài"))
		return
	}
	list, err := h.svc.Board(r.Context(), q)
	h.reply(w, r, list, err)
}

// GET /airports
func (h *Handler) Airports(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Airports(r.Context())
	h.reply(w, r, list, err)
}

// GET /wifi-plans
func (h *Handler) WifiPlans(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.WifiPlans(r.Context())
	h.reply(w, r, list, err)
}

// GET /me/flights
func (h *Handler) Mine(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Mine(r.Context(), userID(r))
	h.reply(w, r, list, err)
}

// POST /me/flights  {"code": "VN 220", "date": "2026-11-05", "seat": "3A", "cabin": "business"}
func (h *Handler) Add(w http.ResponseWriter, r *http.Request) {
	var in AddInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.Add(r.Context(), userID(r), in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// DELETE /me/flights/{id}
func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, r, h.log, errNoFl)
		return
	}
	if err := h.svc.Remove(r.Context(), userID(r), id); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}
