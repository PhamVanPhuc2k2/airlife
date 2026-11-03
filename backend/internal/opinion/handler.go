package opinion

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
	svc      *Service
	log      *slog.Logger
	clientIP func(*http.Request) string
}

func NewHandler(svc *Service, log *slog.Logger, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, clientIP: clientIP}
}

// GET /experiences?cursor=…
func (h *Handler) Experiences(w http.ResponseWriter, r *http.Request) {
	page, err := h.svc.Experiences(r.Context(), r.URL.Query().Get("cursor"), viewer(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// POST /experiences — cần đăng nhập. Body: {"route": "SGN → HAN", "rating": 5, "body": "..."}
func (h *Handler) CreateExperience(w http.ResponseWriter, r *http.Request) {
	var in ExperienceInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	actor, _ := auth.ActorFrom(r.Context())
	e, err := h.svc.CreateExperience(r.Context(), actor, in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, e)
}

// POST|DELETE /experiences/{id}/like — cần đăng nhập
func (h *Handler) Like(w http.ResponseWriter, r *http.Request)   { h.setLike(w, r, true) }
func (h *Handler) Unlike(w http.ResponseWriter, r *http.Request) { h.setLike(w, r, false) }

func (h *Handler) setLike(w http.ResponseWriter, r *http.Request, like bool) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	actor, _ := auth.ActorFrom(r.Context())
	likes, err := h.svc.SetLike(r.Context(), actor, id, like)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, map[string]any{"liked": like, "like_count": likes})
}

// DELETE /experiences/{id} — người viết, biên tập viên hoặc quản trị
func (h *Handler) DeleteExperience(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	actor, _ := auth.ActorFrom(r.Context())
	if err := h.svc.DeleteExperience(r.Context(), actor, id); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// GET /surveys
func (h *Handler) Surveys(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Surveys(r.Context(), viewer(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, list)
}

// POST /surveys/{id}/vote — cần đăng nhập. Body: {"option_id": "<uuid>"}
func (h *Handler) Vote(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in struct {
		OptionID uuid.UUID `json:"option_id"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	actor, _ := auth.ActorFrom(r.Context())
	if err := h.svc.Vote(r.Context(), actor, id, in.OptionID); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /feedback — công khai, có Turnstile (middleware gắn ở server.go)
func (h *Handler) Feedback(w http.ResponseWriter, r *http.Request) {
	var in FeedbackInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.Feedback(r.Context(), viewer(r), h.clientIP(r), in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

func viewer(r *http.Request) *auth.Actor {
	if a, ok := auth.ActorFrom(r.Context()); ok {
		return &a
	}
	return nil
}

func (h *Handler) id(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, r, h.log, apperr.NotFound("not_found", "Không tìm thấy"))
		return uuid.Nil, false
	}
	return id, true
}
