# Bài 6.02: Module thư viện: service, handler, thử API

> [← Bài trước](01-schema-thu-vien.md) · [Mục lục](../README.md) · [Bài sau →](03-ghi-tien-do-xem.md)

## Mục tiêu

`backend/internal/library`: ghi tiến độ xem, lịch sử, đã lưu, playlist, số liệu cho trang Bạn. Tất cả
nằm dưới `/api/v1/me/...` và cần đăng nhập.

## Bạn sẽ học

- Gom các route cần đăng nhập vào một nhóm `r.Route("/me", ...)` với `r.Use(requireAuth)`.
- Nhận dữ liệu từ client nhưng không tin hoàn toàn: kẹp vị trí xem, giới hạn thời lượng.
- Khoá dòng (`FOR UPDATE`) khi phải "đọc rồi ghi" một số đếm có giới hạn.
- Khi nào chấp nhận được việc giới hạn không chính xác tuyệt đối.

## Viết code

### Bước 1: Dùng lại thẻ media và mở rộng kênh

Thêm vào `backend/internal/media/repository.go`, trước `LineupMonths`:

```go
// CardOf dựng Card từ dòng media và kênh đầy đủ. Dùng cho truy vấn có sqlc.embed ở module khác
// (thư viện cá nhân: lịch sử xem, đã lưu, playlist).
func CardOf(m db.Medium, c db.Channel) Card {
	return Card{
		ID: m.ID, Slug: m.Slug, Kind: m.Kind, Category: m.CategorySlug, Title: m.Title,
		GroupLabel: m.GroupLabel, GenreLabel: m.GenreLabel, YoutubeID: m.YoutubeID,
		ThumbnailURL: m.ThumbnailUrl, DurationSeconds: m.DurationSeconds, EpisodeCount: m.EpisodeCount,
		ViewCount: m.ViewCount, Featured: m.Featured, PublishedAt: m.PublishedAt,
		Channel: Channel{Slug: c.Slug, Name: c.Name, Verified: c.Verified},
	}
}
```

`Brief` trong `backend/internal/channel/channel.go` có thêm loại kênh, số người theo dõi, ảnh. Bản đầy đủ:

```go
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

// Brief: một kênh trong danh sách "Kênh đang theo dõi" (menu dọc, trang Bạn).
type Brief struct {
	Slug      string  `json:"slug"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Verified  bool    `json:"verified"`
	Followers int64   `json:"followers_count"`
	AvatarURL *string `json:"avatar_url"`
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
		out = append(out, Brief{
			Slug: r.Slug, Name: r.Name, Type: r.Type, Verified: r.Verified,
			Followers: r.FollowersCount, AvatarURL: r.AvatarUrl,
		})
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
```

### Bước 2: Service, `backend/internal/library/library.go`

```go
// Package library: thư viện cá nhân của từng người (trang Bạn, Sưu tập): lịch sử xem và tiến độ
// "Tiếp tục xem", nội dung đã lưu, playlist riêng.
//
// Mọi hàm nhận userID của người đang đăng nhập và chỉ chạm vào dữ liệu của người đó: truy vấn nào
// cũng có điều kiện user_id, nên đoán id playlist của người khác cũng chỉ nhận 404.
package library

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	pageSize      = 24
	continueLimit = 12
	maxPlaylists  = 50  // playlist / người
	maxItems      = 200 // mục / playlist
	maxNameRunes  = 100
	maxDuration   = 24 * 60 * 60 // 24 giờ: video YouTube dài hơn thế coi như dữ liệu sai
)

var (
	slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

	errMediaNotFound    = apperr.NotFound("media_not_found", "Không tìm thấy nội dung")
	errPlaylistNotFound = apperr.NotFound("playlist_not_found", "Không tìm thấy playlist")
	errBadName          = apperr.Invalid("validation_failed", "Tên playlist từ 1 đến 100 ký tự").
				WithFields(map[string]string{"name": "Tên playlist từ 1 đến 100 ký tự"})
)

// Progress: đã xem tới giây thứ mấy trên tổng bao nhiêu giây.
type Progress struct {
	Position int32 `json:"position"`
	Duration int32 `json:"duration"`
}

// Item: một media trong thư viện. Progress chỉ có ở lịch sử xem.
type Item struct {
	media.Card
	Progress *Progress `json:"progress,omitempty"`
}

type Page struct {
	Items      []Item `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// MediaState: trạng thái của một media với người đang xem (trang xem dùng để hiện nút Lưu,
// danh sách playlist đã có media này, và xem tiếp từ chỗ dừng).
type MediaState struct {
	Saved       bool        `json:"saved"`
	Progress    *Progress   `json:"progress"`
	PlaylistIDs []uuid.UUID `json:"playlist_ids"`
}

type Stats struct {
	Following int64 `json:"following"`
	Saved     int64 `json:"saved"`
	Playlists int64 `json:"playlists"`
	Watched   int64 `json:"watched"`
}

type Playlist struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	ItemCount int32     `json:"item_count"`
	UpdatedAt time.Time `json:"updated_at"`
	// Mục đầu tiên: ảnh bìa và nút "Phát tất cả". Playlist rỗng thì không có.
	First *FirstItem `json:"first,omitempty"`
}

type FirstItem struct {
	Slug         string `json:"slug"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnail_url"`
}

type PlaylistDetail struct {
	Playlist
	Items []Item `json:"items"`
}

// con trỏ phân trang của lịch sử xem và đã lưu: (thời điểm, media_id) của mục cuối trang trước
type cursor struct {
	T  time.Time `json:"t"`
	ID uuid.UUID `json:"id"`
}

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: db.New(pool)}
}

// Lịch sử xem -------------------------------------------------------------------------------

// SaveProgress ghi tiến độ xem. Trình phát gọi khoảng 15 giây một lần khi đang phát, và khi dừng.
func (s *Service) SaveProgress(ctx context.Context, userID uuid.UUID, slug string, p Progress) error {
	if !slugRe.MatchString(slug) {
		return errMediaNotFound
	}
	if p.Duration <= 0 || p.Duration > maxDuration || p.Position < 0 {
		return apperr.Invalid("invalid_progress", "Tiến độ xem không hợp lệ")
	}
	// Trình phát có thể báo vị trí lố tổng thời lượng một chút ở giây cuối: kẹp lại thay vì báo lỗi
	p.Position = min(p.Position, p.Duration)
	n, err := s.q.UpsertWatchProgress(ctx, db.UpsertWatchProgressParams{
		UserID: userID, Slug: slug, Position: p.Position, Duration: p.Duration,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return errMediaNotFound
	}
	return nil
}

func (s *Service) History(ctx context.Context, userID uuid.UUID, cursorStr string) (Page, error) {
	var c cursor
	has, err := pagination.Decode(cursorStr, &c)
	if err != nil {
		return Page{}, err
	}
	arg := db.ListWatchHistoryParams{UserID: userID, Limit: pageSize + 1}
	if has {
		arg.CursorTime, arg.CursorID = &c.T, &c.ID
	}
	rows, err := s.q.ListWatchHistory(ctx, arg)
	if err != nil {
		return Page{}, err
	}
	items := make([]Item, 0, len(rows))
	times := make([]time.Time, 0, len(rows))
	for _, r := range rows {
		items = append(items, Item{
			Card:     media.CardOf(r.Medium, r.Channel),
			Progress: &Progress{Position: r.PositionSeconds, Duration: r.DurationSeconds},
		})
		times = append(times, r.UpdatedAt)
	}
	return page(items, times), nil
}

func (s *Service) Continue(ctx context.Context, userID uuid.UUID) ([]Item, error) {
	rows, err := s.q.ListContinueWatching(ctx, db.ListContinueWatchingParams{UserID: userID, Limit: continueLimit})
	if err != nil {
		return nil, err
	}
	items := make([]Item, 0, len(rows))
	for _, r := range rows {
		items = append(items, Item{
			Card:     media.CardOf(r.Medium, r.Channel),
			Progress: &Progress{Position: r.PositionSeconds, Duration: r.DurationSeconds},
		})
	}
	return items, nil
}

func (s *Service) RemoveHistory(ctx context.Context, userID uuid.UUID, slug string) error {
	return s.q.DeleteWatchHistoryItem(ctx, db.DeleteWatchHistoryItemParams{UserID: userID, Slug: slug})
}

func (s *Service) ClearHistory(ctx context.Context, userID uuid.UUID) error {
	return s.q.ClearWatchHistory(ctx, userID)
}

// Đã lưu ------------------------------------------------------------------------------------

func (s *Service) Save(ctx context.Context, userID uuid.UUID, slug string) error {
	if !slugRe.MatchString(slug) {
		return errMediaNotFound
	}
	n, err := s.q.SaveMedia(ctx, db.SaveMediaParams{UserID: userID, Slug: slug})
	if err != nil || n == 1 {
		return err
	}
	// 0 dòng: đã lưu từ trước (ON CONFLICT DO NOTHING, không phải lỗi) hoặc media không tồn tại
	return s.mediaExists(ctx, s.q, slug)
}

// mediaExists trả errMediaNotFound nếu không có media đang đăng với slug này.
func (s *Service) mediaExists(ctx context.Context, q *db.Queries, slug string) error {
	_, err := q.GetMediaIDBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return errMediaNotFound
	}
	return err
}

func (s *Service) Unsave(ctx context.Context, userID uuid.UUID, slug string) error {
	return s.q.UnsaveMedia(ctx, db.UnsaveMediaParams{UserID: userID, Slug: slug})
}

func (s *Service) Saved(ctx context.Context, userID uuid.UUID, cursorStr string) (Page, error) {
	var c cursor
	has, err := pagination.Decode(cursorStr, &c)
	if err != nil {
		return Page{}, err
	}
	arg := db.ListSavedMediaParams{UserID: userID, Limit: pageSize + 1}
	if has {
		arg.CursorTime, arg.CursorID = &c.T, &c.ID
	}
	rows, err := s.q.ListSavedMedia(ctx, arg)
	if err != nil {
		return Page{}, err
	}
	items := make([]Item, 0, len(rows))
	times := make([]time.Time, 0, len(rows))
	for _, r := range rows {
		items = append(items, Item{Card: media.CardOf(r.Medium, r.Channel)})
		times = append(times, r.SavedAt)
	}
	return page(items, times), nil
}

// page cắt mục thừa (lấy pageSize+1 để biết còn trang sau không) và tạo con trỏ trang sau.
func page(items []Item, times []time.Time) Page {
	p := Page{Items: items}
	if len(items) > pageSize {
		p.Items = items[:pageSize]
		last := pageSize - 1
		p.NextCursor = pagination.Encode(cursor{T: times[last], ID: items[last].ID})
	}
	return p
}

// Trạng thái, số liệu -----------------------------------------------------------------------

func (s *Service) MediaState(ctx context.Context, userID uuid.UUID, slug string) (MediaState, error) {
	if !slugRe.MatchString(slug) {
		return MediaState{}, errMediaNotFound
	}
	r, err := s.q.GetMediaLibraryState(ctx, db.GetMediaLibraryStateParams{UserID: userID, Slug: slug})
	if errors.Is(err, pgx.ErrNoRows) {
		return MediaState{}, errMediaNotFound
	}
	if err != nil {
		return MediaState{}, err
	}
	st := MediaState{Saved: r.Saved, PlaylistIDs: r.PlaylistIds}
	if r.PositionSeconds != nil && r.DurationSeconds != nil {
		st.Progress = &Progress{Position: *r.PositionSeconds, Duration: *r.DurationSeconds}
	}
	return st, nil
}

func (s *Service) Stats(ctx context.Context, userID uuid.UUID) (Stats, error) {
	r, err := s.q.GetLibraryStats(ctx, userID)
	return Stats(r), err
}

// Playlist ----------------------------------------------------------------------------------

func (s *Service) Playlists(ctx context.Context, userID uuid.UUID) ([]Playlist, error) {
	rows, err := s.q.ListPlaylists(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Playlist, 0, len(rows))
	for _, r := range rows {
		p := Playlist{ID: r.ID, Name: r.Name, ItemCount: r.ItemCount, UpdatedAt: r.UpdatedAt}
		if r.FirstSlug != "" {
			p.First = &FirstItem{Slug: r.FirstSlug, Category: r.FirstCategory, ThumbnailURL: r.FirstThumbnail}
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *Service) CreatePlaylist(ctx context.Context, userID uuid.UUID, name string) (Playlist, error) {
	name, err := cleanName(name)
	if err != nil {
		return Playlist{}, err
	}
	// Đếm rồi mới thêm, hai request cùng lúc có thể lọt thành 51 playlist. Chấp nhận được: giới
	// hạn này chỉ để chặn lạm dụng, không cần chính xác tuyệt đối như số mục trong playlist.
	n, err := s.q.CountPlaylists(ctx, userID)
	if err != nil {
		return Playlist{}, err
	}
	if n >= maxPlaylists {
		return Playlist{}, apperr.Conflict("playlist_limit", "Bạn đã có tối đa 50 playlist")
	}
	r, err := s.q.CreatePlaylist(ctx, db.CreatePlaylistParams{UserID: userID, Name: name})
	if err != nil {
		return Playlist{}, err
	}
	return Playlist{ID: r.ID, Name: r.Name, ItemCount: r.ItemCount, UpdatedAt: r.UpdatedAt}, nil
}

func (s *Service) Playlist(ctx context.Context, userID, id uuid.UUID) (PlaylistDetail, error) {
	p, err := s.q.GetPlaylist(ctx, db.GetPlaylistParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return PlaylistDetail{}, errPlaylistNotFound
	}
	if err != nil {
		return PlaylistDetail{}, err
	}
	rows, err := s.q.ListPlaylistItems(ctx, id)
	if err != nil {
		return PlaylistDetail{}, err
	}
	d := PlaylistDetail{
		Playlist: Playlist{ID: p.ID, Name: p.Name, ItemCount: p.ItemCount, UpdatedAt: p.UpdatedAt},
		Items:    make([]Item, 0, len(rows)),
	}
	for _, r := range rows {
		d.Items = append(d.Items, Item{Card: media.CardOf(r.Medium, r.Channel)})
	}
	return d, nil
}

func (s *Service) RenamePlaylist(ctx context.Context, userID, id uuid.UUID, name string) error {
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	n, err := s.q.RenamePlaylist(ctx, db.RenamePlaylistParams{ID: id, UserID: userID, Name: name})
	if err != nil {
		return err
	}
	if n == 0 {
		return errPlaylistNotFound
	}
	return nil
}

func (s *Service) DeletePlaylist(ctx context.Context, userID, id uuid.UUID) error {
	n, err := s.q.DeletePlaylist(ctx, db.DeletePlaylistParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return errPlaylistNotFound
	}
	return nil
}

// SetItem thêm (add = true) hoặc bớt một media khỏi playlist.
//
// Chạy trong transaction và khoá dòng playlist (SELECT ... FOR UPDATE): hai request thêm cùng lúc
// phải chờ nhau, nên item_count và giới hạn 200 mục luôn đúng. Kiểm tra quyền sở hữu nằm luôn
// trong câu khoá (WHERE user_id).
func (s *Service) SetItem(ctx context.Context, userID, id uuid.UUID, slug string, add bool) error {
	if !slugRe.MatchString(slug) {
		return errMediaNotFound
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		p, err := q.LockPlaylist(ctx, db.LockPlaylistParams{ID: id, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return errPlaylistNotFound
		}
		if err != nil {
			return err
		}
		var changed int64
		var delta int32 = 1
		if add {
			if p.ItemCount >= maxItems {
				return apperr.Conflict("playlist_full", "Playlist đã đủ 200 mục")
			}
			changed, err = q.AddPlaylistItem(ctx, db.AddPlaylistItemParams{PlaylistID: id, Slug: slug})
		} else {
			changed, err = q.RemovePlaylistItem(ctx, db.RemovePlaylistItemParams{PlaylistID: id, Slug: slug})
			delta = -1
		}
		if err != nil {
			return err
		}
		if changed == 0 {
			if add {
				return s.mediaExists(ctx, q, slug) // đã có trong playlist, hoặc media không tồn tại
			}
			return nil // đã bớt từ trước
		}
		return q.AddPlaylistItemCount(ctx, db.AddPlaylistItemCountParams{ID: id, Delta: delta})
	})
}

func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n == 0 || n > maxNameRunes {
		return "", errBadName
	}
	return name, nil
}
```

- **`SaveProgress` kẹp `Position` về `Duration`**: ở giây cuối, trình phát có thể báo vị trí lố tổng thời
  lượng một chút; báo lỗi thì người xem mất tiến độ vô lý. Nhưng `Duration` quá 24 giờ hay vị trí âm là dữ
  liệu sai, trả `400`.
- **`Save` lưu hai lần không lỗi**: `ON CONFLICT DO NOTHING` thêm 0 dòng. Chỉ khi đó mới hỏi thêm "media có
  tồn tại không" để trả `404` cho slug sai; lần lưu bình thường chỉ tốn một truy vấn.
- **`SetItem` khoá dòng playlist**: không khoá thì hai request thêm cùng lúc đều đọc `item_count = 199`,
  đều thấy chưa đủ 200, và playlist có 201 mục.
- **`CreatePlaylist` không khoá**: đếm rồi thêm, hai request cùng lúc có thể ra 51 playlist. Giới hạn 50 chỉ
  để chặn lạm dụng; sai một hai cái không hại gì, nên không cần phức tạp thêm. Biết khi nào **không** cần
  làm chặt cũng quan trọng như biết cách làm chặt.
- **Phân trang**: lấy `pageSize + 1` dòng; có dòng thừa nghĩa là còn trang sau (hàm `page`).

### Bước 3: Handler, `backend/internal/library/handler.go`

```go
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
```

`reply` gom ba nhánh hay lặp lại (lỗi / 204 / 200 kèm dữ liệu) để mỗi handler còn 2–3 dòng.

### Bước 4: Routes, `backend/internal/server/server.go`

Thay dòng `r.With(requireAuth).Get("/me/following", channelH.Following)` của Phần 05 bằng nhóm `/me`.
Bản đầy đủ:

```go
// Package server dựng router go-chi: middleware dùng chung, health check và các nhóm API.
//
// Mỗi module nghiệp vụ (media, product…) sẽ có handler riêng và được gắn vào
// nhóm /api/v1 trong Handler(). File này lớn dần qua các phần của khoá học.
package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/category"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/channel"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/comment"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/home"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/library"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/news"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Deps gom các kết nối hạ tầng mà handler cần. cmd/api tạo một lần rồi truyền vào.
type Deps struct {
	Config   config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Redis    *redis.Client
	RabbitMQ *amqp.Connection
}

type Server struct {
	deps Deps
}

func New(deps Deps) *Server {
	return &Server{deps: deps}
}

// Handler trả http.Handler đã gắn đủ middleware và route.
func (s *Server) Handler() (http.Handler, error) {
	trusted, err := parsePrefixes(s.deps.Config.HTTP.TrustedProxies)
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()

	// Thứ tự middleware có ý nghĩa: realIP và RequestID phải chạy trước logger
	// để dòng log có IP và request_id; recoverer bọc mọi thứ phía sau.
	r.Use(realIP(trusted))
	r.Use(middleware.RequestID)
	r.Use(requestLogger(s.deps.Log))
	r.Use(recoverer(s.deps.Log))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.deps.Config.HTTP.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language"},
		AllowCredentials: true, // cần để trình duyệt gửi cookie refresh token
		MaxAge:           300,
	}))
	// Huỷ context của request quá lâu (truy vấn DB treo…) và trả 504.
	// http.Server ở cmd/api đặt WriteTimeout dài hơn mức này một chút để kịp gửi 504.
	r.Use(middleware.Timeout(s.deps.Config.HTTP.WriteTimeout))
	r.Use(sameOrigin(s.deps.Config.HTTP.CORSOrigins))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.NotFound("route_not_found", "Không tìm thấy đường dẫn"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.Invalid("method_not_allowed", "Phương thức không được hỗ trợ"))
	})

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	// Nối dây các module: repository/service/handler tạo một lần ở đây.
	q := db.New(s.deps.DB)
	clientIP := func(r *http.Request) string { return ClientIP(r.Context()) }

	categorySvc := category.NewService(q, s.deps.Redis)
	categoryH := category.NewHandler(categorySvc, s.deps.Log)

	mediaSvc := media.NewService(media.NewRepository(q), s.deps.Redis)
	mediaH := media.NewHandler(mediaSvc, s.deps.Log, clientIP)

	channelH := channel.NewHandler(channel.NewService(s.deps.DB), s.deps.Log)
	commentSvc := comment.NewService(s.deps.DB, s.deps.Redis)
	commentH := comment.NewHandler(commentSvc, s.deps.Log)
	libraryH := library.NewHandler(library.NewService(s.deps.DB), s.deps.Log)
	homeH := home.NewHandler(home.NewService(mediaSvc, commentSvc, s.deps.Redis), s.deps.Log)

	authCfg := s.deps.Config.Auth
	tokens := auth.NewTokenIssuer(authCfg.JWTSecret, authCfg.AccessTTL)
	// Hàng đợi gửi mail: khai báo queue (đã có thì thôi) và mở publisher
	if err := queue.DeclareJobQueue(s.deps.RabbitMQ, mail.Queue); err != nil {
		return nil, err
	}
	publisher, err := queue.NewPublisher(s.deps.RabbitMQ)
	if err != nil {
		return nil, err
	}
	authSvc, err := auth.NewService(q, s.deps.Redis, tokens, auth.NewSessions(s.deps.Redis, authCfg.RefreshTTL),
		publisher, s.deps.Config.App.PublicURL)
	if err != nil {
		return nil, err
	}
	authH := auth.NewHandler(authSvc, s.deps.Log, auth.CookieConfig{
		Domain:     authCfg.CookieDomain,
		Secure:     s.deps.Config.App.Env != "development", // dev chạy http://localhost
		AccessTTL:  authCfg.AccessTTL,
		RefreshTTL: authCfg.RefreshTTL,
	}, clientIP)
	requireAuth := auth.RequireAuth(s.deps.Log)
	newsH := news.NewHandler(news.NewService(q, s.deps.Redis), s.deps.Log)

	r.Route("/api/v1", func(r chi.Router) {
		// Mọi API đều biết ai đang gọi (nếu có đăng nhập); API nào bắt buộc đăng nhập thì thêm
		// requireAuth.
		r.Use(auth.Authenticate(tokens))

		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			response.OK(w, map[string]string{"message": "pong"})
		})

		r.Get("/home", homeH.Get)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", authH.Register)
			r.Post("/login", authH.Login)
			r.Post("/refresh", authH.Refresh)
			r.Post("/logout", authH.Logout)
			r.With(requireAuth).Get("/me", authH.Me)
			r.Post("/verify-email", authH.VerifyEmail)
			r.With(requireAuth).Post("/verify-email/resend", authH.ResendVerifyEmail)
			r.Post("/forgot-password", authH.ForgotPassword)
			r.Post("/reset-password", authH.ResetPassword)
		})

		r.Get("/categories", categoryH.List)
		r.Get("/categories/{slug}", categoryH.Get)

		r.Get("/media", mediaH.List)
		r.Get("/media/{slug}", mediaH.Get)
		r.Get("/media/{slug}/related", mediaH.Related)
		r.Post("/media/{slug}/views", mediaH.RecordView)
		r.Get("/lineup/months", mediaH.LineupMonths)

		r.Get("/channels/{slug}", channelH.Get)
		r.With(requireAuth).Post("/channels/{slug}/follow", channelH.Follow)
		r.With(requireAuth).Delete("/channels/{slug}/follow", channelH.Unfollow)

		// Thư viện cá nhân (trang Bạn, Sưu tập): mọi route đều cần đăng nhập
		r.Route("/me", func(r chi.Router) {
			r.Use(requireAuth)
			r.Get("/following", channelH.Following)
			r.Get("/stats", libraryH.Stats)
			r.Get("/media/{slug}", libraryH.MediaState)

			r.Get("/continue", libraryH.Continue)
			r.Get("/history", libraryH.History)
			r.Delete("/history", libraryH.ClearHistory)
			r.Put("/history/{slug}", libraryH.SaveProgress)
			r.Delete("/history/{slug}", libraryH.RemoveHistory)

			r.Get("/saved", libraryH.Saved)
			r.Put("/saved/{slug}", libraryH.Save)
			r.Delete("/saved/{slug}", libraryH.Unsave)

			r.Get("/playlists", libraryH.Playlists)
			r.Post("/playlists", libraryH.CreatePlaylist)
			r.Get("/playlists/{id}", libraryH.Playlist)
			r.Patch("/playlists/{id}", libraryH.RenamePlaylist)
			r.Delete("/playlists/{id}", libraryH.DeletePlaylist)
			r.Put("/playlists/{id}/items/{slug}", libraryH.AddItem)
			r.Delete("/playlists/{id}/items/{slug}", libraryH.RemoveItem)
		})

		r.Get("/media/{slug}/comments", commentH.List("media"))
		r.With(requireAuth).Post("/media/{slug}/comments", commentH.Create("media"))
		r.Get("/news/{slug}/comments", commentH.List("news"))
		r.With(requireAuth).Post("/news/{slug}/comments", commentH.Create("news"))
		r.Get("/comments/{id}/replies", commentH.Replies)
		r.With(requireAuth).Post("/comments/{id}/like", commentH.Like)
		r.With(requireAuth).Delete("/comments/{id}/like", commentH.Unlike)
		r.With(requireAuth).Delete("/comments/{id}", commentH.Delete)

		// /news/categories khai báo trước /news/{slug}; chi luôn ưu tiên đường dẫn tĩnh, nên
		// "categories" không bao giờ bị hiểu nhầm là một slug bài viết.
		r.Get("/news/categories", newsH.Categories)
		r.Get("/news", newsH.List)
		r.Get("/news/{slug}", newsH.Get)
		r.Get("/news/{slug}/related", newsH.Related)
	})

	return r, nil
}

func parsePrefixes(list []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			return nil, fmt.Errorf("HTTP_TRUSTED_PROXIES có giá trị sai %q: %w", s, err)
		}
		out = append(out, p)
	}
	return out, nil
}
```

- **`r.Route("/me", ...)` + `r.Use(requireAuth)`**: mọi route trong nhóm đều cần đăng nhập; thêm route mới
  vào nhóm là không thể quên `requireAuth`.
- **`PUT` cho lưu, thêm vào playlist, ghi tiến độ**: gọi lại bao nhiêu lần kết quả vẫn vậy (idempotent).
  Mạng chập chờn, trình duyệt gửi lại cũng không sao.

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

Thử bằng curl. Lưu thành file `thu6.sh` ở **ngoài** repo rồi chạy `bash thu6.sh`. Không cần xác minh email:

```bash
A=localhost:8080/api/v1; H='-H Content-Type:application/json'; O='-H Origin:http://localhost:3000'
E="thu6-$(date +%s)@example.com"
curl -s -o /dev/null -c j.txt $H $O -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Sáu\"}" $A/auth/register
C="-b j.txt $O"
echo "--- khách"; curl -s $A/me/stats; echo
echo "--- tiến độ"
curl -s -o /dev/null -w "%{http_code} " $C $H -X PUT -d '{"position":600,"duration":5400}' $A/me/history/vung-troi-cuoi-cung
curl -s -o /dev/null -w "%{http_code} " $C $H -X PUT -d '{"position":10,"duration":3000}' $A/me/history/chuyen-bay-ve-nha
curl -s -o /dev/null -w "%{http_code} " $C $H -X PUT -d '{"position":5000,"duration":5000}' $A/me/history/ghe-12a
curl -s -o /dev/null -w "%{http_code}\n" $C $H -X PUT -d '{"position":9999,"duration":100}' $A/me/history/hanh-lang-so-7-mua-2
curl -s $C $H -X PUT -d '{"position":-1,"duration":100}' $A/me/history/ghe-12a; echo
curl -s $C $H -X PUT -d '{"position":1,"duration":100}' $A/me/history/khong-co; echo
echo "continue:"; curl -s $C $A/me/continue | python3 -c "import sys,json;print([(i['slug'],i['progress']) for i in json.load(sys.stdin)['data']])"
echo "history:"; curl -s $C $A/me/history | python3 -c "import sys,json;print([(i['slug'],i['progress']) for i in json.load(sys.stdin)['data']['items']])"
echo "--- lưu 2 lần"
curl -s -o /dev/null -w "%{http_code} " $C -X PUT $A/me/saved/vung-troi-cuoi-cung
curl -s -o /dev/null -w "%{http_code} " $C -X PUT $A/me/saved/vung-troi-cuoi-cung
curl -s -w " " $C -X PUT $A/me/saved/khong-co; echo
curl -s $C $A/me/saved | python3 -c "import sys,json;print([i['slug'] for i in json.load(sys.stdin)['data']['items']])"
echo "--- playlist"
P=$(curl -s $C $H -d '{"name":"  Xem trên chuyến bay dài  "}' $A/me/playlists | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['id'])")
curl -s $C $H -d '{"name":""}' $A/me/playlists; echo
for s in vung-troi-cuoi-cung ghe-12a vung-troi-cuoi-cung; do curl -s -o /dev/null -w "%{http_code} " $C -X PUT $A/me/playlists/$P/items/$s; done; echo
curl -s $C $A/me/playlists; echo
curl -s $C $A/me/media/vung-troi-cuoi-cung; echo
curl -s -o /dev/null -w "rename %{http_code}\n" $C $H -X PATCH -d '{"name":"Bay đêm"}' $A/me/playlists/$P
curl -s -o /dev/null -w "remove %{http_code} " $C -X DELETE $A/me/playlists/$P/items/ghe-12a
curl -s $C $A/me/playlists/$P | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['name'],d['item_count'],[i['slug'] for i in d['items']])"
echo "--- người khác"
curl -s -o /dev/null -c k.txt $H $O -d "{\"email\":\"x$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Người Khác\"}" $A/auth/register
curl -s -b k.txt $A/me/playlists/$P; echo
curl -s -b k.txt $O -X PUT $A/me/playlists/$P/items/ghe-12a; echo
curl -s -b k.txt $O -X DELETE $A/me/playlists/$P; echo
curl -s $C $A/me/playlists/khong-phai-uuid; echo
echo "stats:"; curl -s $C $A/me/stats; echo
curl -s -o /dev/null -w "clear %{http_code} " $C -X DELETE $A/me/history
curl -s -o /dev/null -w "del %{http_code}\n" $C -X DELETE $A/me/playlists/$P
curl -s $C $A/me/stats; echo
rm -f j.txt k.txt
```

Kết quả thật:

```text
--- khách
{"error":{"code":"unauthorized","message":"Bạn cần đăng nhập","request_id":"…"}}

--- tiến độ
204 204 204 204
{"error":{"code":"invalid_progress","message":"Tiến độ xem không hợp lệ","request_id":"…"}}

{"error":{"code":"media_not_found","message":"Không tìm thấy nội dung","request_id":"…"}}

continue:
[('vung-troi-cuoi-cung', {'position': 600, 'duration': 5400})]
history:
[('hanh-lang-so-7-mua-2', {'position': 100, 'duration': 100}), ('ghe-12a', {'position': 5000, 'duration': 5000}), ('chuyen-bay-ve-nha', {'position': 10, 'duration': 3000}), ('vung-troi-cuoi-cung', {'position': 600, 'duration': 5400})]
--- lưu 2 lần
204 204 {"error":{"code":"media_not_found","message":"Không tìm thấy nội dung","request_id":"…"}}
 
['vung-troi-cuoi-cung']
--- playlist
{"error":{"code":"validation_failed","message":"Tên playlist từ 1 đến 100 ký tự","fields":{"name":"Tên playlist từ 1 đến 100 ký tự"},"request_id":"…"}}

204 204 204 
{"data":[{"id":"f167c0bb-af68-45b4-8140-aa581014413b","name":"Xem trên chuyến bay dài","item_count":2,"updated_at":"2026-10-29T08:14:14.321853Z","first":{"slug":"vung-troi-cuoi-cung","category":"xem","thumbnail_url":"https://picsum.photos/seed/airlife-vung-troi-cuoi-cung/640/360"}}]}

{"data":{"saved":true,"progress":{"position":600,"duration":5400},"playlist_ids":["f167c0bb-af68-45b4-8140-aa581014413b"]}}

rename 204
remove 204 Bay đêm 1 ['vung-troi-cuoi-cung']
--- người khác
{"error":{"code":"playlist_not_found","message":"Không tìm thấy playlist","request_id":"…"}}

{"error":{"code":"playlist_not_found","message":"Không tìm thấy playlist","request_id":"…"}}

{"error":{"code":"playlist_not_found","message":"Không tìm thấy playlist","request_id":"…"}}

{"error":{"code":"playlist_not_found","message":"Không tìm thấy playlist","request_id":"…"}}

stats:
{"data":{"following":0,"saved":1,"playlists":1,"watched":4}}

clear 204 del 204
{"data":{"following":0,"saved":1,"playlists":0,"watched":0}}

```

Đọc kết quả:

- **Khách**: `401`.
- **Tiến độ**: `ghe-12a` xem hết (5000/5000) và `chuyen-bay-ve-nha` mới 10 giây nên **không** nằm trong
  "Tiếp tục xem", nhưng vẫn có trong "Đã xem". `9999/100` được kẹp thành `100/100`.
- **Tên playlist** có dấu cách thừa ở hai đầu được cắt bớt.
- **Thêm cùng một media hai lần**: `item_count` vẫn là 2 (2 media khác nhau), không phải 3.
- **Người khác** xem, thêm, xoá playlist: đều `404`, không phải `403`. Trả `403` là thừa nhận playlist đó
  có tồn tại.
- **Sau khi xoá lịch sử và playlist**: `watched` và `playlists` về 0, `saved` vẫn 1.

Dọn tài khoản thử:

```bash
make psql
```

```sql
DELETE FROM users WHERE email ~ '^x?thu6-';
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `PUT` từ trình duyệt bị chặn CORS | `AllowedMethods` phải có `PUT`, `PATCH` (đã có từ bài 0.08) |
| Playlist có 201 mục khi bấm nhanh | Đọc `item_count` không có `FOR UPDATE`, hoặc đọc bằng `s.q` (ngoài transaction) thay vì `db.New(tx)` |
| Xem playlist người khác ra `403` | Kiểm tra quyền sau khi đã lấy playlist; đưa `user_id` vào ngay câu `WHERE` |
