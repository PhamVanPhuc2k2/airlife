// Package admin: API trang quản trị (kiểm duyệt, khảo sát, đơn hàng, hoàn tiền, người dùng, số liệu).
//
// Mọi route nằm dưới /admin, chặn bởi RequireRole. Mọi thao tác ghi vào audit_log.
package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

var (
	errNotFound = apperr.NotFound("not_found", "Không tìm thấy")
	errStale    = apperr.Conflict("state_changed", "Dữ liệu vừa được người khác thay đổi, hãy tải lại trang")
)

// Roles gom nhóm quyền: editor làm nội dung và kiểm duyệt; admin làm thêm đơn hàng, tiền, người dùng.
var (
	Staff  = []string{"editor", "admin"}
	Admins = []string{"admin"}
)

// RequireRole chặn người không có một trong các vai trò. Vai trò đọc từ DATABASE mỗi request,
// không tin vai trò trong access token (sống 15 phút): vừa bị hạ quyền hoặc khoá thì bị chặn ngay.
func RequireRole(q *db.Queries, log *slog.Logger, roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			actor, ok := auth.ActorFrom(r.Context())
			if !ok {
				response.Error(w, r, log, apperr.Unauthorized("unauthorized", "Bạn cần đăng nhập"))
				return
			}
			u, err := q.AdminRole(r.Context(), actor.UserID)
			if err != nil {
				response.Error(w, r, log, err)
				return
			}
			if u.Status != "active" || !contains(roles, u.Role) {
				response.Error(w, r, log, apperr.Forbidden("forbidden", "Bạn không có quyền truy cập khu vực này"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

type Service struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	sessions *auth.Sessions
}

func NewService(pool *pgxpool.Pool, sessions *auth.Sessions) *Service {
	return &Service{pool: pool, q: db.New(pool), sessions: sessions}
}

// Paging: tham số trang của danh sách quản trị.
type Paging struct {
	Page, Size int32 // int32 như cột LIMIT/OFFSET của sqlc; handler đã giới hạn trang ≤ 10000, cỡ ≤ 50
}

func (p Paging) limit() int32  { return p.Size }
func (p Paging) offset() int32 { return (p.Page - 1) * p.Size }

type Page[T any] struct {
	Items []T   `json:"items"`
	Total int64 `json:"total"`
	Page  int32 `json:"page"`
	Size  int32 `json:"size"`
}

func newPage[T any](items []T, total int64, p Paging) Page[T] {
	if items == nil {
		items = []T{}
	}
	return Page[T]{Items: items, Total: total, Page: p.Page, Size: p.Size}
}

func (s *Service) audit(ctx context.Context, q *db.Queries, actor auth.Actor, action, typ, id string, detail map[string]any) error {
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	return q.InsertAudit(ctx, db.InsertAuditParams{
		ActorID: &actor.UserID, Action: action, TargetType: typ, TargetID: id, Detail: raw,
	})
}

// ---- Số liệu ----

type Stats struct {
	UsersTotal        int64 `json:"users_total"`
	UsersWeek         int64 `json:"users_week"`
	OrdersTotal       int64 `json:"orders_total"`
	OrdersPending     int64 `json:"orders_pending"`
	OrdersRevenue     int64 `json:"orders_revenue"`
	BookingsConfirmed int64 `json:"bookings_confirmed"`
	PaymentsRevenue   int64 `json:"payments_revenue"`
	RefundsPending    int64 `json:"refunds_pending"`
	FeedbacksNew      int64 `json:"feedbacks_new"`
	CommentsHidden    int64 `json:"comments_hidden"`
	MediaViews        int64 `json:"media_views"`
}

func (s *Service) Stats(ctx context.Context) (Stats, error) {
	r, err := s.q.AdminStats(ctx)
	if err != nil {
		return Stats{}, err
	}
	return Stats(r), nil
}

type AuditEntry struct {
	ID         int64           `json:"id"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Detail     json.RawMessage `json:"detail"`
	CreatedAt  time.Time       `json:"created_at"`
	Actor      string          `json:"actor"`
}

func (s *Service) Audit(ctx context.Context) ([]AuditEntry, error) {
	rows, err := s.q.ListAudit(ctx, 30)
	if err != nil {
		return nil, err
	}
	out := make([]AuditEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, AuditEntry{
			ID: r.ID, Action: r.Action, TargetType: r.TargetType, TargetID: r.TargetID,
			Detail: r.Detail, CreatedAt: r.CreatedAt, Actor: r.ActorName,
		})
	}
	return out, nil
}

// ---- Kiểm duyệt ----

type CommentRow struct {
	ID        uuid.UUID `json:"id"`
	Body      string    `json:"body"`
	Status    string    `json:"status"`
	Likes     int32     `json:"like_count"`
	CreatedAt time.Time `json:"created_at"`
	Author    string    `json:"author"`
	Target    string    `json:"target"`
}

func (s *Service) Comments(ctx context.Context, status, q string, p Paging) (Page[CommentRow], error) {
	rows, err := s.q.AdminListComments(ctx, db.AdminListCommentsParams{Status: status, Q: q, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[CommentRow]{}, err
	}
	var total int64
	out := make([]CommentRow, 0, len(rows))
	for _, r := range rows {
		total = r.Total
		out = append(out, CommentRow{
			ID: r.ID, Body: r.Body, Status: r.Status, Likes: r.LikeCount,
			CreatedAt: r.CreatedAt, Author: r.Author, Target: r.Target,
		})
	}
	return newPage(out, total, p), nil
}

// SetCommentStatus ẩn / hiện lại bình luận. Bình luận người viết đã tự xoá thì không khôi phục.
// Số trả lời của bình luận gốc phải đổi theo, giống lúc người viết tự xoá.
func (s *Service) SetCommentStatus(ctx context.Context, actor auth.Actor, id uuid.UUID, status string) error {
	if status != "visible" && status != "hidden" {
		return apperr.Invalid("invalid_status", "Trạng thái chỉ nhận visible hoặc hidden")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		cm, err := q.AdminGetComment(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if cm.Status == "deleted" {
			return apperr.Conflict("comment_deleted", "Người viết đã tự xoá bình luận này")
		}
		if cm.Status == status {
			return nil
		}
		if err := q.AdminSetCommentStatus(ctx, db.AdminSetCommentStatusParams{ID: id, Status: status}); err != nil {
			return err
		}
		if cm.ParentID != nil {
			var delta int32 = 1
			if status == "hidden" {
				delta = -1
			}
			if err := q.AddReplyCount(ctx, db.AddReplyCountParams{ID: *cm.ParentID, Delta: delta}); err != nil {
				return err
			}
		}
		return s.audit(ctx, q, actor, "comment."+status, "comment", id.String(), map[string]any{"from": cm.Status})
	})
}

type ExperienceRow struct {
	ID        uuid.UUID `json:"id"`
	Route     string    `json:"route"`
	Rating    int16     `json:"rating"`
	Body      string    `json:"body"`
	Status    string    `json:"status"`
	Likes     int32     `json:"like_count"`
	CreatedAt time.Time `json:"created_at"`
	Author    string    `json:"author"`
}

func (s *Service) Experiences(ctx context.Context, status, q string, p Paging) (Page[ExperienceRow], error) {
	rows, err := s.q.AdminListExperiences(ctx, db.AdminListExperiencesParams{Status: status, Q: q, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[ExperienceRow]{}, err
	}
	var total int64
	out := make([]ExperienceRow, 0, len(rows))
	for _, r := range rows {
		total = r.Total
		out = append(out, ExperienceRow{
			ID: r.ID, Route: r.Route, Rating: r.Rating, Body: r.Body, Status: r.Status,
			Likes: r.LikeCount, CreatedAt: r.CreatedAt, Author: r.Author,
		})
	}
	return newPage(out, total, p), nil
}

func (s *Service) SetExperienceStatus(ctx context.Context, actor auth.Actor, id uuid.UUID, status string) error {
	if status != "visible" && status != "hidden" {
		return apperr.Invalid("invalid_status", "Trạng thái chỉ nhận visible hoặc hidden")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		e, err := q.GetExperience(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if e.Status == "deleted" {
			return apperr.Conflict("experience_deleted", "Người viết đã tự xoá bài này")
		}
		if _, err := q.AdminSetExperienceStatus(ctx, db.AdminSetExperienceStatusParams{ID: id, Status: status}); err != nil {
			return err
		}
		return s.audit(ctx, q, actor, "experience."+status, "experience", id.String(), map[string]any{"from": e.Status})
	})
}

type FeedbackRow struct {
	ID         uuid.UUID `json:"id"`
	Topic      string    `json:"topic"`
	Rating     int16     `json:"rating"`
	Body       string    `json:"body"`
	FlightCode *string   `json:"flight_code"`
	Email      *string   `json:"email"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	Author     string    `json:"author"`
}

func (s *Service) Feedbacks(ctx context.Context, status string, p Paging) (Page[FeedbackRow], error) {
	rows, err := s.q.AdminListFeedbacks(ctx, db.AdminListFeedbacksParams{Status: status, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[FeedbackRow]{}, err
	}
	var total int64
	out := make([]FeedbackRow, 0, len(rows))
	for _, r := range rows {
		total = r.Total
		out = append(out, FeedbackRow{
			ID: r.ID, Topic: r.Topic, Rating: r.Rating, Body: r.Body, FlightCode: r.FlightCode,
			Email: r.Email, Status: r.Status, CreatedAt: r.CreatedAt, Author: r.Author,
		})
	}
	return newPage(out, total, p), nil
}

func (s *Service) SetFeedbackStatus(ctx context.Context, actor auth.Actor, id uuid.UUID, status string) error {
	if status != "new" && status != "done" {
		return apperr.Invalid("invalid_status", "Trạng thái chỉ nhận new hoặc done")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		n, err := q.AdminSetFeedbackStatus(ctx, db.AdminSetFeedbackStatusParams{ID: id, Status: status})
		if err != nil {
			return err
		}
		if n == 0 {
			return errNotFound
		}
		return s.audit(ctx, q, actor, "feedback."+status, "feedback", id.String(), nil)
	})
}

// ---- Khảo sát ----

type SurveyRow struct {
	ID        uuid.UUID `json:"id"`
	Question  string    `json:"question"`
	Status    string    `json:"status"`
	Votes     int64     `json:"votes"`
	Options   int64     `json:"options"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) Surveys(ctx context.Context) ([]SurveyRow, error) {
	rows, err := s.q.AdminListSurveys(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]SurveyRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, SurveyRow{
			ID: r.ID, Question: r.Question, Status: r.Status, Votes: r.Votes,
			Options: r.Options, CreatedAt: r.CreatedAt,
		})
	}
	return out, nil
}

type SurveyInput struct {
	Question string   `json:"question"`
	Options  []string `json:"options"`
}

// CreateSurvey tạo khảo sát (mở ngay) với 2–6 phương án. Phương án KHÔNG sửa được sau khi tạo:
// đổi chữ một phương án đã có phiếu là làm sai ý người đã chọn. Muốn đổi thì đóng và tạo mới.
func (s *Service) CreateSurvey(ctx context.Context, actor auth.Actor, in SurveyInput) (uuid.UUID, error) {
	in.Question = strings.TrimSpace(in.Question)
	fields := map[string]string{}
	if n := utf8.RuneCountInString(in.Question); n < 5 || n > 200 {
		fields["question"] = "Câu hỏi từ 5 đến 200 ký tự"
	}
	var labels []string
	for _, o := range in.Options {
		if o = strings.TrimSpace(o); o != "" {
			if utf8.RuneCountInString(o) > 100 {
				fields["options"] = "Mỗi phương án tối đa 100 ký tự"
			}
			labels = append(labels, o)
		}
	}
	if len(labels) < 2 || len(labels) > 6 {
		fields["options"] = "Cần từ 2 đến 6 phương án"
	}
	if len(fields) > 0 {
		return uuid.Nil, apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").WithFields(fields)
	}
	var id uuid.UUID
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		var err error
		if id, err = q.AdminCreateSurvey(ctx, in.Question); err != nil {
			return err
		}
		for i, l := range labels {
			if err := q.AdminCreateSurveyOption(ctx, db.AdminCreateSurveyOptionParams{SurveyID: id, Label: l, Position: int32(i)}); err != nil {
				return err
			}
		}
		return s.audit(ctx, q, actor, "survey.create", "survey", id.String(), map[string]any{"question": in.Question})
	})
	return id, err
}

func (s *Service) UpdateSurvey(ctx context.Context, actor auth.Actor, id uuid.UUID, question, status string) error {
	question = strings.TrimSpace(question)
	if n := utf8.RuneCountInString(question); n < 5 || n > 200 {
		return apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").WithFields(map[string]string{"question": "Câu hỏi từ 5 đến 200 ký tự"})
	}
	if status != "open" && status != "closed" && status != "hidden" {
		return apperr.Invalid("invalid_status", "Trạng thái chỉ nhận open, closed hoặc hidden")
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		n, err := q.AdminUpdateSurvey(ctx, db.AdminUpdateSurveyParams{ID: id, Question: question, Status: status})
		if err != nil {
			return err
		}
		if n == 0 {
			return errNotFound
		}
		return s.audit(ctx, q, actor, "survey.update", "survey", id.String(), map[string]any{"status": status})
	})
}

func (s *Service) DeleteSurvey(ctx context.Context, actor auth.Actor, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		n, err := q.AdminDeleteSurvey(ctx, id)
		if err != nil {
			return err
		}
		if n == 0 {
			return errNotFound
		}
		return s.audit(ctx, q, actor, "survey.delete", "survey", id.String(), nil)
	})
}
