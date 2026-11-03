# Bài 11.02: Trải nghiệm: đăng bài, thích, xoá

> [← Bài trước](01-du-lieu-y-kien.md) · [Mục lục](../README.md) · [Bài sau →](03-khao-sat.md)

## Mục tiêu

Làm API cho dòng chảy trải nghiệm: xem (phân trang con trỏ), đăng, thích/bỏ thích, xoá.

## Bạn sẽ học

- Gom lỗi **mọi ô** của form rồi trả một lần (`WithFields`), thay vì báo từng lỗi một.
- Chống spam bài viết: bắt buộc xác minh email + giới hạn tốc độ bằng Redis.
- Thích/bỏ thích **idempotent** (bấm hai lần không đếm đôi), trong một transaction.
- Đánh dấu bài "của tôi" và "tôi đã thích" bằng **một** truy vấn cho cả trang.

## Viết code

### Bước 1: Service, `backend/internal/opinion/opinion.go`

```go
// Package opinion: trải nghiệm chuyến bay, khảo sát và góp ý (trang Ý kiến).
package opinion

import (
	"context"
	"errors"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const pageSize = 10

var (
	errNotFound    = apperr.NotFound("experience_not_found", "Không tìm thấy bài chia sẻ")
	errNotVerified = apperr.Forbidden("email_not_verified", "Bạn cần xác minh email trước khi tham gia")
	// Mã chuyến bay: hãng 2 ký tự + số, có thể có dấu cách ("VN 220").
	flightCodeRe = regexp.MustCompile(`^[A-Z0-9]{2}\s?[0-9]{1,4}$`)
	topics       = map[string]bool{"content": true, "shop": true, "tour": true, "utility": true, "website": true, "other": true}
)

type Author struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"display_name"`
	AvatarURL *string   `json:"avatar_url"`
}

type Experience struct {
	ID        uuid.UUID `json:"id"`
	Author    Author    `json:"author"`
	Route     string    `json:"route"`
	Rating    int16     `json:"rating"`
	Body      string    `json:"body"`
	Likes     int32     `json:"like_count"`
	CreatedAt time.Time `json:"created_at"`
	LikedByMe bool      `json:"liked_by_me"`
	Mine      bool      `json:"mine"`
}

type ExperiencePage struct {
	Items      []Experience `json:"items"`
	NextCursor string       `json:"next_cursor,omitempty"`
}

type cursor struct {
	Time time.Time `json:"t"`
	ID   uuid.UUID `json:"id"`
}

type Option struct {
	ID      uuid.UUID `json:"id"`
	Label   string    `json:"label"`
	Votes   int       `json:"votes"`
	Percent int       `json:"percent"`
}

type Survey struct {
	ID       uuid.UUID  `json:"id"`
	Question string     `json:"question"`
	Open     bool       `json:"open"`
	Total    int        `json:"total_votes"`
	Options  []Option   `json:"options"`
	MyOption *uuid.UUID `json:"my_option"` // phương án người xem đã chọn; null = chưa bình chọn
}

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	rdb  *redis.Client
}

func NewService(pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{pool: pool, q: db.New(pool), rdb: rdb}
}

// ---- Trải nghiệm ----

func (s *Service) Experiences(ctx context.Context, cursorStr string, viewer *auth.Actor) (ExperiencePage, error) {
	var cur cursor
	hasCur, err := pagination.Decode(cursorStr, &cur)
	if err != nil {
		return ExperiencePage{}, err
	}
	p := db.ListExperiencesParams{Limit: pageSize + 1}
	if hasCur {
		p.CursorTime, p.CursorID = &cur.Time, &cur.ID
	}
	rows, err := s.q.ListExperiences(ctx, p)
	if err != nil {
		return ExperiencePage{}, err
	}
	page := ExperiencePage{Items: make([]Experience, 0, len(rows))}
	for _, r := range rows {
		page.Items = append(page.Items, Experience{
			ID: r.ID, Author: Author{ID: r.UserID, Name: r.DisplayName, AvatarURL: r.AvatarUrl},
			Route: r.Route, Rating: r.Rating, Body: r.Body, Likes: r.LikeCount, CreatedAt: r.CreatedAt,
		})
	}
	if len(page.Items) > pageSize {
		page.Items = page.Items[:pageSize]
		last := page.Items[pageSize-1]
		page.NextCursor = pagination.Encode(cursor{Time: last.CreatedAt, ID: last.ID})
	}
	return page, s.markViewer(ctx, page.Items, viewer)
}

type ExperienceInput struct {
	Route  string `json:"route"`
	Rating int16  `json:"rating"`
	Body   string `json:"body"`
}

func (s *Service) CreateExperience(ctx context.Context, actor auth.Actor, in ExperienceInput) (Experience, error) {
	in.Route = strings.Join(strings.Fields(in.Route), " ")
	in.Body = strings.TrimSpace(in.Body)
	fields := map[string]string{}
	if n := utf8.RuneCountInString(in.Route); n < 3 || n > 40 {
		fields["route"] = "Chặng bay từ 3 đến 40 ký tự, ví dụ SGN → HAN"
	}
	if in.Rating < 1 || in.Rating > 5 {
		fields["rating"] = "Chọn từ 1 đến 5 sao"
	}
	if n := utf8.RuneCountInString(in.Body); n < 10 || n > 2000 {
		fields["body"] = "Nội dung từ 10 đến 2000 ký tự"
	}
	if len(fields) > 0 {
		return Experience{}, apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").WithFields(fields)
	}
	user, err := s.verifiedUser(ctx, actor)
	if err != nil {
		return Experience{}, err
	}
	if err := s.limit(ctx, "exp:"+actor.UserID.String(), 5, time.Hour,
		apperr.TooMany("too_many_experiences", "Bạn đăng quá nhiều, vui lòng thử lại sau")); err != nil {
		return Experience{}, err
	}
	row, err := s.q.CreateExperience(ctx, db.CreateExperienceParams{
		UserID: actor.UserID, Route: in.Route, Rating: in.Rating, Body: in.Body,
	})
	if err != nil {
		return Experience{}, err
	}
	return Experience{
		ID: row.ID, Author: Author{ID: user.ID, Name: user.DisplayName, AvatarURL: user.AvatarUrl},
		Route: in.Route, Rating: in.Rating, Body: in.Body, CreatedAt: row.CreatedAt, Mine: true,
	}, nil
}

// SetLike thích / bỏ thích một bài. Trả số lượt thích mới.
func (s *Service) SetLike(ctx context.Context, actor auth.Actor, id uuid.UUID, like bool) (int32, error) {
	var likes int32
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		e, err := q.GetExperience(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && e.Status != "visible") {
			return errNotFound
		}
		if err != nil {
			return err
		}
		var changed int64
		var delta int32 = 1
		if like {
			changed, err = q.LikeExperience(ctx, db.LikeExperienceParams{ExperienceID: id, UserID: actor.UserID})
		} else {
			changed, err = q.UnlikeExperience(ctx, db.UnlikeExperienceParams{ExperienceID: id, UserID: actor.UserID})
			delta = -1
		}
		if err != nil {
			return err
		}
		if changed == 0 {
			delta = 0 // đã thích / đã bỏ từ trước: chỉ đọc lại số hiện tại
		}
		likes, err = q.AddExperienceLikes(ctx, db.AddExperienceLikesParams{ID: id, Delta: delta})
		return err
	})
	return likes, err
}

func (s *Service) DeleteExperience(ctx context.Context, actor auth.Actor, id uuid.UUID) error {
	e, err := s.q.GetExperience(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && e.Status != "visible") {
		return errNotFound
	}
	if err != nil {
		return err
	}
	if e.UserID != actor.UserID && actor.Role != "editor" && actor.Role != "admin" {
		return apperr.Forbidden("forbidden", "Bạn không có quyền xoá bài này")
	}
	return s.q.SoftDeleteExperience(ctx, id)
}

func (s *Service) markViewer(ctx context.Context, items []Experience, viewer *auth.Actor) error {
	if viewer == nil || len(items) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(items))
	for i, e := range items {
		ids[i] = e.ID
	}
	liked, err := s.q.LikedExperiences(ctx, db.LikedExperiencesParams{UserID: viewer.UserID, Ids: ids})
	if err != nil {
		return err
	}
	set := make(map[uuid.UUID]bool, len(liked))
	for _, id := range liked {
		set[id] = true
	}
	for i := range items {
		items[i].LikedByMe = set[items[i].ID]
		items[i].Mine = items[i].Author.ID == viewer.UserID
	}
	return nil
}

// ---- Khảo sát ----

// Surveys trả mọi khảo sát kèm kết quả. Kết quả công khai ngay cả khi chưa bình chọn: không có
// lý do giấu, và người xem biết được mình đang bình chọn cho điều gì.
func (s *Service) Surveys(ctx context.Context, viewer *auth.Actor) ([]Survey, error) {
	rows, err := s.q.ListSurveyOptions(ctx)
	if err != nil {
		return nil, err
	}
	var out []Survey
	for _, r := range rows {
		if len(out) == 0 || out[len(out)-1].ID != r.SurveyID {
			out = append(out, Survey{ID: r.SurveyID, Question: r.Question, Open: r.Status == "open"})
		}
		sv := &out[len(out)-1]
		sv.Options = append(sv.Options, Option{ID: r.OptionID, Label: r.Label, Votes: int(r.Votes)})
		sv.Total += int(r.Votes)
	}
	mine := map[uuid.UUID]uuid.UUID{}
	if viewer != nil {
		votes, err := s.q.MySurveyVotes(ctx, viewer.UserID)
		if err != nil {
			return nil, err
		}
		for _, v := range votes {
			mine[v.SurveyID] = v.OptionID
		}
	}
	for i := range out {
		sv := &out[i]
		for j := range sv.Options {
			if sv.Total > 0 {
				sv.Options[j].Percent = (sv.Options[j].Votes*100 + sv.Total/2) / sv.Total
			}
		}
		if id, ok := mine[sv.ID]; ok {
			sv.MyOption = &id
		}
	}
	if out == nil {
		out = []Survey{}
	}
	return out, nil
}

// Vote ghi một phiếu. Một người một phiếu mỗi khảo sát; không đổi ý được (kết quả công khai nên
// cho đổi ý sẽ làm số phiếu nhảy lung tung và dễ bị lợi dụng).
func (s *Service) Vote(ctx context.Context, actor auth.Actor, surveyID, optionID uuid.UUID) error {
	if _, err := s.verifiedUser(ctx, actor); err != nil {
		return err
	}
	status, err := s.q.GetSurveyStatus(ctx, surveyID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && status == "hidden") {
		return apperr.NotFound("survey_not_found", "Không tìm thấy khảo sát")
	}
	if err != nil {
		return err
	}
	if status != "open" {
		return apperr.Conflict("survey_closed", "Khảo sát này đã đóng")
	}
	n, err := s.q.CastVote(ctx, db.CastVoteParams{SurveyID: surveyID, UserID: actor.UserID, OptionID: optionID})
	if err != nil {
		// Khoá ngoại ghép (option_id, survey_id) không khớp: phương án không thuộc khảo sát này
		if isForeignKey(err) {
			return apperr.Invalid("invalid_option", "Phương án không thuộc khảo sát này")
		}
		return err
	}
	if n == 0 {
		return apperr.Conflict("already_voted", "Bạn đã bình chọn khảo sát này rồi")
	}
	return nil
}

// ---- Góp ý ----

type FeedbackInput struct {
	Topic      string `json:"topic"`
	Rating     int16  `json:"rating"`
	Body       string `json:"body"`
	FlightCode string `json:"flight_code"`
	Email      string `json:"email"`
}

// Feedback lưu một góp ý. actor có thể nil (khách chưa đăng nhập). ip dùng để giới hạn tốc độ:
// Turnstile chặn bot, còn giới hạn này chặn người thật gửi dồn dập.
func (s *Service) Feedback(ctx context.Context, actor *auth.Actor, ip string, in FeedbackInput) error {
	in.Body = strings.TrimSpace(in.Body)
	in.FlightCode = strings.ToUpper(strings.TrimSpace(in.FlightCode))
	in.Email = strings.TrimSpace(in.Email)
	fields := map[string]string{}
	if !topics[in.Topic] {
		fields["topic"] = "Chọn nội dung bạn góp ý"
	}
	if in.Rating < 1 || in.Rating > 5 {
		fields["rating"] = "Chọn mức hài lòng từ 1 đến 5"
	}
	if n := utf8.RuneCountInString(in.Body); n < 10 || n > 3000 {
		fields["body"] = "Nội dung từ 10 đến 3000 ký tự"
	}
	if in.FlightCode != "" && !flightCodeRe.MatchString(in.FlightCode) {
		fields["flight_code"] = "Số hiệu không hợp lệ, ví dụ VN 220"
	}
	if in.Email != "" {
		if a, err := mail.ParseAddress(in.Email); err != nil || a.Address != in.Email || len(in.Email) > 254 {
			fields["email"] = "Email không hợp lệ"
		}
	}
	if len(fields) > 0 {
		return apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").WithFields(fields)
	}
	if err := s.limit(ctx, "feedback:"+ip, 5, time.Hour,
		apperr.TooMany("too_many_feedbacks", "Bạn gửi góp ý quá nhiều, vui lòng thử lại sau")); err != nil {
		return err
	}
	p := db.CreateFeedbackParams{Topic: in.Topic, Rating: in.Rating, Body: in.Body}
	if actor != nil {
		p.UserID = &actor.UserID
	}
	if in.FlightCode != "" {
		p.FlightCode = &in.FlightCode
	}
	if in.Email != "" {
		p.Email = &in.Email
	}
	return s.q.CreateFeedback(ctx, p)
}

// ---- dùng chung ----

func (s *Service) verifiedUser(ctx context.Context, actor auth.Actor) (db.GetUserByIDRow, error) {
	u, err := s.q.GetUserByID(ctx, actor.UserID)
	if err != nil {
		return db.GetUserByIDRow{}, err
	}
	if u.EmailVerifiedAt == nil {
		return db.GetUserByIDRow{}, errNotVerified
	}
	return u, nil
}

// limit: tối đa n lần mỗi window cho một khoá (cửa sổ cố định trong Redis).
func (s *Service) limit(ctx context.Context, key string, n int64, window time.Duration, errOver error) error {
	key = "opinion:rate:" + key
	pipe := s.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	if incr.Val() > n {
		return errOver
	}
	return nil
}

func isForeignKey(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
```

Điểm cần để ý:

- **Chuẩn hoá trước khi kiểm tra**: `strings.Fields` rồi `Join` gộp nhiều dấu cách ("SGN  →  HAN" thành "SGN → HAN"); `TrimSpace` cho nội dung.
  Độ dài đo bằng `utf8.RuneCountInString` (ký tự), không phải `len` (byte): tiếng Việt có dấu mỗi chữ chiếm 2–3 byte.
- **Kiểm tra dữ liệu trước, xác minh email và giới hạn tốc độ sau.** Người gõ sai không bị trừ lượt đăng.
- `SetLike`: `LikeExperience` trả số dòng thật sự thêm. 0 dòng (đã thích) thì `delta = 0`, chỉ đọc lại số hiện tại. Cộng trừ bằng `GREATEST(…, 0)` nên không bao giờ âm.
- `DeleteExperience` là **xoá mềm** (`status = 'deleted'`): người viết hoặc editor/admin được xoá; người khác nhận 403.

### Bước 2: Handler, `backend/internal/opinion/handler.go`

```go
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
```

### Bước 3: Gắn route, `backend/internal/server/server.go`

Các route nằm trong khối "Ý kiến (Phần 11)": `GET /experiences` công khai (người đăng nhập thì thêm `liked_by_me`, `mine`), còn đăng, thích, xoá đi qua `requireAuth`.

## Kiểm tra

Xem bài 11.05.

## Hay gặp lỗi

- **Bài mới đăng không hiện ở đầu danh sách**: con trỏ `(created_at, id)` phải cùng chiều với `ORDER BY created_at DESC, id DESC`. Đảo một vế là trang 2 lặp hoặc mất bài.
- **Số like nhảy lung tung khi bấm nhanh**: quên `ON CONFLICT DO NOTHING` + đọc số dòng, hoặc cộng `like_count` ngoài transaction.
