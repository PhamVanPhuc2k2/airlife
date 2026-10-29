// Package channel: trang kênh, theo dõi kênh.
package channel

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

var (
	slugRe      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	errNotFound = apperr.NotFound("channel_not_found", "Không tìm thấy kênh")
)

type Channel struct {
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Type        string  `json:"type"` // distributor | creator | business | travel
	Verified    bool    `json:"verified"`
	Followers   int64   `json:"followers_count"`
	Description string  `json:"description"`
	AvatarURL   *string `json:"avatar_url"`
	MediaCount  int64   `json:"media_count"`
	// Người đang xem có theo dõi kênh không; luôn false với khách chưa đăng nhập
	Following bool `json:"following"`
}

type FollowState struct {
	Following bool  `json:"following"`
	Followers int64 `json:"followers_count"`
}

type Brief struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Verified bool   `json:"verified"`
}

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: db.New(pool)}
}

func (s *Service) Get(ctx context.Context, slug string, viewer *uuid.UUID) (Channel, error) {
	if !slugRe.MatchString(slug) {
		return Channel{}, errNotFound
	}
	r, err := s.q.GetChannelBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, errNotFound
	}
	if err != nil {
		return Channel{}, err
	}
	c := Channel{
		Slug: r.Slug, Name: r.Name, Type: r.Type, Verified: r.Verified, Followers: r.FollowersCount,
		Description: r.Description, AvatarURL: r.AvatarUrl, MediaCount: r.MediaCount,
	}
	if viewer != nil {
		c.Following, err = s.q.IsFollowing(ctx, db.IsFollowingParams{ChannelID: r.ID, UserID: *viewer})
		if err != nil {
			return Channel{}, err
		}
	}
	return c, nil
}

// SetFollow theo dõi (follow = true) hoặc bỏ theo dõi kênh.
//
// Thêm/xoá dòng channel_followers và cộng/trừ followers_count phải cùng thành công hoặc cùng
// không: chạy trong MỘT transaction. Chỉ cộng/trừ khi thật sự có dòng được thêm/xoá (RowsAffected),
// nên bấm "Theo dõi" hai lần, hay hai tab cùng bấm, số người theo dõi vẫn đúng.
func (s *Service) SetFollow(ctx context.Context, slug string, userID uuid.UUID, follow bool) (FollowState, error) {
	if !slugRe.MatchString(slug) {
		return FollowState{}, errNotFound
	}
	var st FollowState
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		ch, err := q.GetChannelBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		var changed int64
		var delta int64
		if follow {
			changed, err = q.FollowChannel(ctx, db.FollowChannelParams{ChannelID: ch.ID, UserID: userID})
			delta = 1
		} else {
			changed, err = q.UnfollowChannel(ctx, db.UnfollowChannelParams{ChannelID: ch.ID, UserID: userID})
			delta = -1
		}
		if err != nil {
			return err
		}
		st = FollowState{Following: follow, Followers: ch.FollowersCount}
		if changed == 0 {
			return nil // đã ở trạng thái đó rồi: không đổi số đếm
		}
		st.Followers, err = q.AddChannelFollowers(ctx, db.AddChannelFollowersParams{ID: ch.ID, Delta: delta})
		return err
	})
	return st, err
}

func (s *Service) Following(ctx context.Context, userID uuid.UUID) ([]Brief, error) {
	rows, err := s.q.ListFollowing(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Brief, 0, len(rows))
	for _, r := range rows {
		out = append(out, Brief{Slug: r.Slug, Name: r.Name, Verified: r.Verified})
	}
	return out, nil
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/channels/{slug} — có đăng nhập thì kèm "following"
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	var viewer *uuid.UUID
	if a, ok := auth.ActorFrom(r.Context()); ok {
		viewer = &a.UserID
	}
	c, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"), viewer)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, c)
}

// POST /api/v1/channels/{slug}/follow — cần đăng nhập
func (h *Handler) Follow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, true) }

// DELETE /api/v1/channels/{slug}/follow — cần đăng nhập
func (h *Handler) Unfollow(w http.ResponseWriter, r *http.Request) { h.setFollow(w, r, false) }

func (h *Handler) setFollow(w http.ResponseWriter, r *http.Request, follow bool) {
	actor, _ := auth.ActorFrom(r.Context())
	st, err := h.svc.SetFollow(r.Context(), chi.URLParam(r, "slug"), actor.UserID, follow)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, st)
}

// GET /api/v1/me/following — cần đăng nhập
func (h *Handler) Following(w http.ResponseWriter, r *http.Request) {
	actor, _ := auth.ActorFrom(r.Context())
	list, err := h.svc.Following(r.Context(), actor.UserID)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, list)
}
