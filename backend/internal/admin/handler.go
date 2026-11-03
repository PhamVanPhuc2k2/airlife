package admin

import (
	"log/slog"
	"net/http"
	"strconv"

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

func NewHandler(svc *Service, log *slog.Logger) *Handler { return &Handler{svc: svc, log: log} }

func paging(r *http.Request) Paging {
	q := r.URL.Query()
	p := Paging{Page: 1, Size: 20}
	if n, err := strconv.ParseInt(q.Get("page"), 10, 32); err == nil && n >= 1 && n <= 10000 {
		p.Page = int32(n)
	}
	if n, err := strconv.ParseInt(q.Get("size"), 10, 32); err == nil && n >= 1 && n <= 50 {
		p.Size = int32(n)
	}
	return p
}

// param đọc tham số lọc, cắt độ dài để không ai nhét chuỗi khổng lồ vào ILIKE.
func param(r *http.Request, key string) string {
	v := r.URL.Query().Get(key)
	if len(v) > 100 {
		v = v[:100]
	}
	return v
}

func (h *Handler) id(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, r, h.log, errNotFound)
		return uuid.Nil, false
	}
	return id, true
}

// done gom phần cuối chung của mọi handler: lỗi thì báo, không thì trả đúng kết quả.
func (h *Handler) done(w http.ResponseWriter, r *http.Request, data any, err error) {
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if data == nil {
		response.NoContent(w)
		return
	}
	response.OK(w, data)
}

func actor(r *http.Request) auth.Actor {
	a, _ := auth.ActorFrom(r.Context())
	return a
}

type statusBody struct {
	Status string `json:"status"`
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Stats(r.Context())
	h.done(w, r, s, err)
}

func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Audit(r.Context())
	h.done(w, r, a, err)
}

func (h *Handler) Comments(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Comments(r.Context(), param(r, "status"), param(r, "q"), paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) SetCommentStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in statusBody
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.SetCommentStatus(r.Context(), actor(r), id, in.Status))
}

func (h *Handler) Experiences(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Experiences(r.Context(), param(r, "status"), param(r, "q"), paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) SetExperienceStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in statusBody
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.SetExperienceStatus(r.Context(), actor(r), id, in.Status))
}

func (h *Handler) Feedbacks(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Feedbacks(r.Context(), param(r, "status"), paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) SetFeedbackStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in statusBody
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.SetFeedbackStatus(r.Context(), actor(r), id, in.Status))
}

func (h *Handler) Surveys(w http.ResponseWriter, r *http.Request) {
	s, err := h.svc.Surveys(r.Context())
	h.done(w, r, s, err)
}

func (h *Handler) CreateSurvey(w http.ResponseWriter, r *http.Request) {
	var in SurveyInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	id, err := h.svc.CreateSurvey(r.Context(), actor(r), in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, map[string]any{"id": id})
}

func (h *Handler) UpdateSurvey(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in struct {
		Question string `json:"question"`
		Status   string `json:"status"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.UpdateSurvey(r.Context(), actor(r), id, in.Question, in.Status))
}

func (h *Handler) DeleteSurvey(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	h.done(w, r, nil, h.svc.DeleteSurvey(r.Context(), actor(r), id))
}

func (h *Handler) Orders(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Orders(r.Context(), param(r, "status"), param(r, "q"), paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) Order(w http.ResponseWriter, r *http.Request) {
	o, err := h.svc.Order(r.Context(), chi.URLParam(r, "code"))
	h.done(w, r, o, err)
}

func (h *Handler) TransitionOrder(w http.ResponseWriter, r *http.Request) {
	var in statusBody
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.TransitionOrder(r.Context(), actor(r), chi.URLParam(r, "code"), in.Status))
}

func (h *Handler) Refunds(w http.ResponseWriter, r *http.Request) {
	filter := param(r, "filter")
	if filter != "done" {
		filter = "pending"
	}
	p, err := h.svc.Refunds(r.Context(), filter, paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) MarkRefunded(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Note string `json:"note"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.MarkRefunded(r.Context(), actor(r), chi.URLParam(r, "code"), in.Note))
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.Users(r.Context(), param(r, "role"), param(r, "q"), paging(r))
	h.done(w, r, p, err)
}

func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var in struct {
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.done(w, r, nil, h.svc.UpdateUser(r.Context(), actor(r), id, in.Role, in.Status))
}
