package comment

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

// List trả handler cho GET /media/{slug}/comments (kind "media") hoặc /news/{slug}/comments.
// ?sort=top|new&cursor=…
func (h *Handler) List(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, err := h.svc.List(r.Context(), Target{Kind: kind, Slug: chi.URLParam(r, "slug")},
			q.Get("sort"), q.Get("cursor"), viewer(r))
		if err != nil {
			response.Error(w, r, h.log, err)
			return
		}
		response.OK(w, page)
	}
}

// Create trả handler cho POST /media/{slug}/comments, /news/{slug}/comments — cần đăng nhập.
// Body: {"body": "...", "parent_id": "<uuid, khi trả lời>"}
func (h *Handler) Create(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in CreateInput
		if err := request.DecodeJSON(w, r, &in); err != nil {
			response.Error(w, r, h.log, err)
			return
		}
		actor, _ := auth.ActorFrom(r.Context())
		c, err := h.svc.Create(r.Context(), actor, Target{Kind: kind, Slug: chi.URLParam(r, "slug")}, in)
		if err != nil {
			response.Error(w, r, h.log, err)
			return
		}
		response.Created(w, c)
	}
}

// GET /comments/{id}/replies?cursor=…
func (h *Handler) Replies(w http.ResponseWriter, r *http.Request) {
	id, ok := commentID(w, r, h.log)
	if !ok {
		return
	}
	page, err := h.svc.Replies(r.Context(), id, r.URL.Query().Get("cursor"), viewer(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// POST /comments/{id}/like, DELETE /comments/{id}/like — cần đăng nhập
func (h *Handler) Like(w http.ResponseWriter, r *http.Request)   { h.setLike(w, r, true) }
func (h *Handler) Unlike(w http.ResponseWriter, r *http.Request) { h.setLike(w, r, false) }

func (h *Handler) setLike(w http.ResponseWriter, r *http.Request, like bool) {
	id, ok := commentID(w, r, h.log)
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

// DELETE /comments/{id} — cần đăng nhập (người viết, biên tập viên, quản trị)
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := commentID(w, r, h.log)
	if !ok {
		return
	}
	actor, _ := auth.ActorFrom(r.Context())
	if err := h.svc.Delete(r.Context(), actor, id); err != nil {
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

func commentID(w http.ResponseWriter, r *http.Request, log *slog.Logger) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, r, log, errNotFound)
		return uuid.Nil, false
	}
	return id, true
}
