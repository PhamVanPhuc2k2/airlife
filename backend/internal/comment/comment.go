// Package comment: bình luận cho media và bài viết, trả lời một cấp, thích, xoá.
package comment

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	pageSize     = 20
	rateLimit    = 10 // bình luận / người / 5 phút
	rateWindow   = 5 * time.Minute
	maxBodyRunes = 2000
)

var (
	errNotFound       = apperr.NotFound("comment_not_found", "Không tìm thấy bình luận")
	errTargetNotFound = apperr.NotFound("target_not_found", "Không tìm thấy nội dung để bình luận")
	errNotVerified    = apperr.Forbidden("email_not_verified", "Bạn cần xác minh email trước khi bình luận")
	errTooMany        = apperr.TooMany("too_many_comments", "Bạn bình luận quá nhanh, vui lòng thử lại sau ít phút")
)

type Author struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"display_name"`
	AvatarURL *string   `json:"avatar_url"`
}

type Comment struct {
	ID        uuid.UUID `json:"id"`
	Author    Author    `json:"author"`
	Body      string    `json:"body"`
	Likes     int32     `json:"like_count"`
	Replies   int32     `json:"reply_count"`
	CreatedAt time.Time `json:"created_at"`
	LikedByMe bool      `json:"liked_by_me"`
	Mine      bool      `json:"mine"` // của người đang xem: hiện nút xoá
}

// HotComment: bình luận nổi bật ở trang chủ, kèm media được bình luận.
type HotComment struct {
	Comment
	Media struct {
		Slug     string `json:"slug"`
		Category string `json:"category"`
		Title    string `json:"title"`
	} `json:"media"`
}

type Page struct {
	Items      []Comment `json:"items"`
	NextCursor string    `json:"next_cursor,omitempty"`
}

// Target: bình luận gắn với media hay bài viết nào.
type Target struct {
	Kind string // "media" | "news"
	Slug string
}

type cursor struct {
	Time  *time.Time `json:"t,omitempty"`
	Likes *int32     `json:"v,omitempty"`
	ID    uuid.UUID  `json:"id"`
}

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	rdb  *redis.Client
}

func NewService(pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{pool: pool, q: db.New(pool), rdb: rdb}
}

// row: các truy vấn danh sách trả cùng cột; sqlc sinh struct riêng cho từng truy vấn nhưng giống
// hệt nhau, đổi kiểu về ListCommentsNewRow là dùng chung một hàm (như module media, bài 2.05).
func toComment(r db.ListCommentsNewRow) Comment {
	return Comment{
		ID: r.ID, Author: Author{ID: r.UserID, Name: r.DisplayName, AvatarURL: r.AvatarUrl},
		Body: r.Body, Likes: r.LikeCount, Replies: r.ReplyCount, CreatedAt: r.CreatedAt,
	}
}

func (s *Service) List(ctx context.Context, t Target, sort, cursorStr string, viewer *auth.Actor) (Page, error) {
	mediaID, newsID, err := s.resolve(ctx, t)
	if err != nil {
		return Page{}, err
	}
	var cur cursor
	hasCur, err := pagination.Decode(cursorStr, &cur)
	if err != nil {
		return Page{}, err
	}

	var items []Comment
	switch sort {
	case "", "top":
		p := db.ListCommentsTopParams{MediaID: mediaID, NewsID: newsID, Limit: pageSize + 1}
		if hasCur {
			p.CursorLikes, p.CursorID = cur.Likes, &cur.ID
		}
		rows, err := s.q.ListCommentsTop(ctx, p)
		if err != nil {
			return Page{}, err
		}
		for _, r := range rows {
			items = append(items, toComment(db.ListCommentsNewRow(r)))
		}
	case "new":
		p := db.ListCommentsNewParams{MediaID: mediaID, NewsID: newsID, Limit: pageSize + 1}
		if hasCur {
			p.CursorTime, p.CursorID = cur.Time, &cur.ID
		}
		rows, err := s.q.ListCommentsNew(ctx, p)
		if err != nil {
			return Page{}, err
		}
		for _, r := range rows {
			items = append(items, toComment(r))
		}
	default:
		return Page{}, apperr.Invalid("invalid_sort", "sort chỉ nhận top hoặc new")
	}

	page := Page{Items: items}
	if len(items) > pageSize {
		page.Items = items[:pageSize]
		last := page.Items[pageSize-1]
		next := cursor{ID: last.ID}
		if sort == "new" {
			next.Time = &last.CreatedAt
		} else {
			next.Likes = &last.Likes
		}
		page.NextCursor = pagination.Encode(next)
	}
	if page.Items == nil {
		page.Items = []Comment{}
	}
	return page, s.markViewer(ctx, page.Items, viewer)
}

func (s *Service) Replies(ctx context.Context, parentID uuid.UUID, cursorStr string, viewer *auth.Actor) (Page, error) {
	var cur cursor
	hasCur, err := pagination.Decode(cursorStr, &cur)
	if err != nil {
		return Page{}, err
	}
	p := db.ListRepliesParams{ParentID: &parentID, Limit: pageSize + 1}
	if hasCur {
		p.CursorTime, p.CursorID = cur.Time, &cur.ID
	}
	rows, err := s.q.ListReplies(ctx, p)
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: make([]Comment, 0, len(rows))}
	for _, r := range rows {
		page.Items = append(page.Items, toComment(db.ListCommentsNewRow(r)))
	}
	if len(page.Items) > pageSize {
		page.Items = page.Items[:pageSize]
		last := page.Items[pageSize-1]
		page.NextCursor = pagination.Encode(cursor{Time: &last.CreatedAt, ID: last.ID})
	}
	return page, s.markViewer(ctx, page.Items, viewer)
}

type CreateInput struct {
	Body     string     `json:"body"`
	ParentID *uuid.UUID `json:"parent_id"`
}

func (s *Service) Create(ctx context.Context, actor auth.Actor, t Target, in CreateInput) (Comment, error) {
	body := strings.TrimSpace(in.Body)
	if n := utf8.RuneCountInString(body); n == 0 || n > maxBodyRunes {
		return Comment{}, apperr.Invalid("validation_failed", "Bình luận từ 1 đến 2000 ký tự").
			WithFields(map[string]string{"body": "Bình luận từ 1 đến 2000 ký tự"})
	}
	user, err := s.q.GetUserByID(ctx, actor.UserID)
	if err != nil {
		return Comment{}, err
	}
	// Chống spam: chỉ tài khoản đã xác minh email mới được bình luận (tạo hàng loạt tài khoản rác
	// bằng email giả là cách spam phổ biến nhất), và giới hạn tốc độ.
	if user.EmailVerifiedAt == nil {
		return Comment{}, errNotVerified
	}
	if err := s.rateLimit(ctx, actor.UserID); err != nil {
		return Comment{}, err
	}
	mediaID, newsID, err := s.resolve(ctx, t)
	if err != nil {
		return Comment{}, err
	}

	var parentID *uuid.UUID
	if in.ParentID != nil {
		parent, err := s.q.GetComment(ctx, *in.ParentID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && parent.Status != "visible") {
			return Comment{}, errNotFound
		}
		if err != nil {
			return Comment{}, err
		}
		// Trả lời phải cùng media/bài viết với bình luận gốc
		if !sameTarget(parent, mediaID, newsID) {
			return Comment{}, errNotFound
		}
		// Chỉ một cấp: trả lời một câu trả lời thì gắn vào bình luận gốc của nó
		parentID = &parent.ID
		if parent.ParentID != nil {
			parentID = parent.ParentID
		}
	}

	var c Comment
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		row, err := q.CreateComment(ctx, db.CreateCommentParams{
			MediaID: mediaID, NewsID: newsID, ParentID: parentID, UserID: actor.UserID, Body: body,
		})
		if err != nil {
			return err
		}
		if parentID != nil {
			if err := q.AddReplyCount(ctx, db.AddReplyCountParams{ID: *parentID, Delta: 1}); err != nil {
				return err
			}
		}
		c = Comment{
			ID: row.ID, Author: Author{ID: user.ID, Name: user.DisplayName, AvatarURL: user.AvatarUrl},
			Body: body, CreatedAt: row.CreatedAt, Mine: true,
		}
		return nil
	})
	return c, err
}

// SetLike thích / bỏ thích. Trả số lượt thích mới.
func (s *Service) SetLike(ctx context.Context, actor auth.Actor, id uuid.UUID, like bool) (int32, error) {
	var likes int32
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		cm, err := q.GetComment(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && cm.Status != "visible") {
			return errNotFound
		}
		if err != nil {
			return err
		}
		var changed int64
		var delta int32 = 1
		if like {
			changed, err = q.LikeComment(ctx, db.LikeCommentParams{CommentID: id, UserID: actor.UserID})
		} else {
			changed, err = q.UnlikeComment(ctx, db.UnlikeCommentParams{CommentID: id, UserID: actor.UserID})
			delta = -1
		}
		if err != nil {
			return err
		}
		if changed == 0 {
			delta = 0 // đã thích/đã bỏ từ trước: chỉ đọc lại số hiện tại
		}
		likes, err = q.AddCommentLikes(ctx, db.AddCommentLikesParams{ID: id, Delta: delta})
		return err
	})
	return likes, err
}

// Delete: người viết tự xoá, hoặc biên tập viên/quản trị xoá. Xoá mềm (status = deleted).
func (s *Service) Delete(ctx context.Context, actor auth.Actor, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		cm, err := q.GetComment(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && cm.Status != "visible") {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if cm.UserID != actor.UserID && actor.Role != "editor" && actor.Role != "admin" {
			return apperr.Forbidden("forbidden", "Bạn không có quyền xoá bình luận này")
		}
		if err := q.SoftDeleteComment(ctx, id); err != nil {
			return err
		}
		if cm.ParentID != nil {
			return q.AddReplyCount(ctx, db.AddReplyCountParams{ID: *cm.ParentID, Delta: -1})
		}
		return nil
	})
}

// Hot: bình luận nổi bật cho trang chủ ("Hay" = nhiều thích, "Nhiều" = nhiều trả lời).
func (s *Service) Hot(ctx context.Context, byReplies bool, limit int32) ([]HotComment, error) {
	rows, err := s.q.ListHotComments(ctx, db.ListHotCommentsParams{ByReplies: byReplies, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]HotComment, 0, len(rows))
	for _, r := range rows {
		h := HotComment{Comment: Comment{
			ID: r.ID, Author: Author{ID: r.UserID, Name: r.DisplayName, AvatarURL: r.AvatarUrl},
			Body: r.Body, Likes: r.LikeCount, Replies: r.ReplyCount, CreatedAt: r.CreatedAt,
		}}
		h.Media.Slug, h.Media.Category, h.Media.Title = r.MediaSlug, r.MediaCategory, r.MediaTitle
		out = append(out, h)
	}
	return out, nil
}

func (s *Service) resolve(ctx context.Context, t Target) (mediaID, newsID *uuid.UUID, err error) {
	var id uuid.UUID
	switch t.Kind {
	case "media":
		id, err = s.q.GetMediaIDBySlug(ctx, t.Slug)
	case "news":
		id, err = s.q.GetNewsIDBySlug(ctx, t.Slug)
	default:
		return nil, nil, errTargetNotFound
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, errTargetNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if t.Kind == "media" {
		return &id, nil, nil
	}
	return nil, &id, nil
}

// markViewer đánh dấu bình luận nào người xem đã thích / là của họ. MỘT truy vấn cho cả trang.
func (s *Service) markViewer(ctx context.Context, items []Comment, viewer *auth.Actor) error {
	if viewer == nil || len(items) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(items))
	for i, c := range items {
		ids[i] = c.ID
	}
	liked, err := s.q.LikedComments(ctx, db.LikedCommentsParams{UserID: viewer.UserID, Ids: ids})
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

func (s *Service) rateLimit(ctx context.Context, userID uuid.UUID) error {
	key := "comment:rate:" + userID.String()
	pipe := s.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, rateWindow)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	if incr.Val() > rateLimit {
		return errTooMany
	}
	return nil
}

func sameTarget(parent db.GetCommentRow, mediaID, newsID *uuid.UUID) bool {
	eq := func(a, b *uuid.UUID) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
	return eq(parent.MediaID, mediaID) && eq(parent.NewsID, newsID)
}
