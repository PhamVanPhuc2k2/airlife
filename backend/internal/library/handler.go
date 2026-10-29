package library

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Mọi route của module này nằm sau requireAuth (server.go), nên luôn có người dùng trong context.
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

// reply ghi lỗi nếu có, không thì ghi data (hoặc 204 khi data == nil).
func (h *Handler) reply(w http.ResponseWriter, r *http.Request, data any, err error) {
	switch {
	case err != nil:
		response.Error(w, r, h.log, err)
	case data == nil:
		response.NoContent(w)
	default:
		response.OK(w, data)
	}
}

// PUT /me/history/{slug}  {"position": 125, "duration": 5400}
func (h *Handler) SaveProgress(w http.ResponseWriter, r *http.Request) {
	var in Progress
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.reply(w, r, nil, h.svc.SaveProgress(r.Context(), userID(r), chi.URLParam(r, "slug"), in))
}

// GET /me/history?cursor=…
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.History(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	h.reply(w, r, p, err)
}

// GET /me/continue
func (h *Handler) Continue(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Continue(r.Context(), userID(r))
	h.reply(w, r, items, err)
}

// DELETE /me/history/{slug}
func (h *Handler) RemoveHistory(w http.ResponseWriter, r *http.Request) {
	h.reply(w, r, nil, h.svc.RemoveHistory(r.Context(), userID(r), chi.URLParam(r, "slug")))
}

// DELETE /me/history
func (h *Handler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	h.reply(w, r, nil, h.svc.ClearHistory(r.Context(), userID(r)))
}

// PUT /me/saved/{slug}
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	h.reply(w, r, nil, h.svc.Save(r.Context(), userID(r), chi.URLParam(r, "slug")))
}

// DELETE /me/saved/{slug}
func (h *Handler) Unsave(w http.ResponseWriter, r *http.Request) {
	h.reply(w, r, nil, h.svc.Unsave(r.Context(), userID(r), chi.URLParam(r, "slug")))
}

// GET /me/saved?cursor=…
func (h *Handler) Saved(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Saved(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	h.reply(w, r, p, err)
}

// GET /me/media/{slug}
func (h *Handler) MediaState(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.MediaState(r.Context(), userID(r), chi.URLParam(r, "slug"))
	h.reply(w, r, st, err)
}

// GET /me/stats
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	st, err := h.svc.Stats(r.Context(), userID(r))
	h.reply(w, r, st, err)
}

// GET /me/playlists
func (h *Handler) Playlists(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Playlists(r.Context(), userID(r))
	h.reply(w, r, list, err)
}

type nameInput struct {
	Name string `json:"name"`
}

// POST /me/playlists  {"name": "Xem trên chuyến bay dài"}
func (h *Handler) CreatePlaylist(w http.ResponseWriter, r *http.Request) {
	var in nameInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	p, err := h.svc.CreatePlaylist(r.Context(), userID(r), in.Name)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, p)
}

// GET /me/playlists/{id}
func (h *Handler) Playlist(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playlistID(w, r)
	if !ok {
		return
	}
	p, err := h.svc.Playlist(r.Context(), userID(r), id)
	h.reply(w, r, p, err)
}

// PATCH /me/playlists/{id}  {"name": "..."}
func (h *Handler) RenamePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playlistID(w, r)
	if !ok {
		return
	}
	var in nameInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.reply(w, r, nil, h.svc.RenamePlaylist(r.Context(), userID(r), id, in.Name))
}

// DELETE /me/playlists/{id}
func (h *Handler) DeletePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playlistID(w, r)
	if !ok {
		return
	}
	h.reply(w, r, nil, h.svc.DeletePlaylist(r.Context(), userID(r), id))
}

// PUT /me/playlists/{id}/items/{slug}
func (h *Handler) AddItem(w http.ResponseWriter, r *http.Request) { h.setItem(w, r, true) }

// DELETE /me/playlists/{id}/items/{slug}
func (h *Handler) RemoveItem(w http.ResponseWriter, r *http.Request) { h.setItem(w, r, false) }

func (h *Handler) setItem(w http.ResponseWriter, r *http.Request, add bool) {
	id, ok := h.playlistID(w, r)
	if !ok {
		return
	}
	h.reply(w, r, nil, h.svc.SetItem(r.Context(), userID(r), id, chi.URLParam(r, "slug"), add))
}

// playlistID đọc {id} trên URL. Sai định dạng uuid thì 404, không để database báo lỗi.
func (h *Handler) playlistID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, r, h.log, errPlaylistNotFound)
		return uuid.Nil, false
	}
	return id, true
}
