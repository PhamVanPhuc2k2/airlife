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
