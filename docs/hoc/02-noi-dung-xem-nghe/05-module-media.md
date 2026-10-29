# Bài 2.05: Module media: repository, service, phân trang con trỏ

> [← Bài trước](04-category-va-cache.md) · [Mục lục](../README.md) · [Bài sau →](06-dem-luot-xem.md)

## Mục tiêu

API danh sách media (lọc theo chuyên mục, chip, line-up; sắp mới nhất hoặc xem nhiều; phân trang),
chi tiết một media và gợi ý liên quan.

## Bạn sẽ học

- Chia tầng: **handler** (HTTP) → **service** (nghiệp vụ) → **repository** (database).
- **Phân trang con trỏ** (keyset) và vì sao tốt hơn `OFFSET`.
- Đổi kiểu giữa hai struct Go có cùng trường.

## Viết code

### Bước 1: Phân trang con trỏ là gì

Cách quen thuộc: `LIMIT 24 OFFSET 48` (trang 3). Hai vấn đề:

1. **Chậm dần**: `OFFSET 10000` bắt PostgreSQL đọc rồi bỏ đi 10.000 dòng.
2. **Trùng/sót khi cuộn**: khách đang ở trang 2, có video mới đăng → mọi dòng bị đẩy xuống 1, trang 3
   lặp lại video cuối của trang 2.

Con trỏ: "cho tôi 24 dòng **đứng sau** dòng cuối cùng tôi đã thấy":

```sql
WHERE (published_at, id) < ($cursor_time, $cursor_id)
ORDER BY published_at DESC, id DESC
```

- So sánh **cặp** `(published_at, id)`: hai video cùng giây đăng vẫn phân biệt được nhờ `id`.
- Index `(category_slug, published_at DESC, id DESC)` của bài 2.01 làm truy vấn này đọc thẳng index,
  nhanh như nhau dù ở trang 1 hay trang 1000.
- Đổi lại: không nhảy thẳng tới "trang 37" được. Với danh sách cuộn vô tận (như YouTube) thì không cần.

### Bước 2: `backend/internal/media/dto.go`

```go
// Package media: video và âm thanh (nhúng từ YouTube) của mục Xem, Nghe.
//
//	dto.go        kiểu dữ liệu trả ra API (JSON)
//	repository.go đọc/ghi database qua code sqlc, đổi dòng DB → DTO
//	service.go    nghiệp vụ: lọc, phân trang con trỏ, kiểm tra tham số
//	views.go      đếm lượt xem bằng Redis, worker gom về database
//	handler.go    HTTP: đọc tham số, gọi service, ghi phản hồi
package media

import (
	"time"

	"github.com/google/uuid"
)

type Channel struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Verified  bool   `json:"verified"`
	Followers int64  `json:"followers_count,omitempty"`
}

// Card: một thẻ media trong danh sách (trang chủ, chuyên mục, gợi ý).
type Card struct {
	ID              uuid.UUID `json:"id"`
	Slug            string    `json:"slug"`
	Kind            string    `json:"kind"` // video | audio
	Category        string    `json:"category"`
	Title           string    `json:"title"`
	Description     string    `json:"description,omitempty"` // chỉ có ở khối nổi bật
	GroupLabel      string    `json:"group_label"`
	GenreLabel      string    `json:"genre_label"`
	YoutubeID       *string   `json:"youtube_id"`
	ThumbnailURL    string    `json:"thumbnail_url"`
	DurationSeconds *int32    `json:"duration_seconds"`
	EpisodeCount    *int32    `json:"episode_count"`
	ViewCount       int64     `json:"view_count"`
	Featured        bool      `json:"featured"`
	PublishedAt     time.Time `json:"published_at"`
	Channel         Channel   `json:"channel"`
}

// Detail: trang xem một media.
type Detail struct {
	Card
	Tags         []string `json:"tags"`
	CategoryName string   `json:"category_name"`
	LineupMonth  *string  `json:"lineup_month"` // "2026-10"
}

// Page: một trang của danh sách. NextCursor rỗng = hết.
type Page struct {
	Items      []Card `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}
```

`Detail` **nhúng** `Card` (`struct { Card; ... }`): JSON của `Detail` có đủ trường của `Card` cộng
thêm trường riêng, không phải khai báo lại.

### Bước 3: `backend/internal/media/repository.go`

```go
package media

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

var errNotFound = apperr.NotFound("media_not_found", "Không tìm thấy nội dung")

// Repository bọc code sqlc sinh ra. Service không biết tới kiểu của sqlc (ListMediaNewRow…),
// chỉ làm việc với DTO, nên đổi câu SQL không ảnh hưởng tới tầng trên.
type Repository struct {
	q *db.Queries
}

func NewRepository(q *db.Queries) *Repository {
	return &Repository{q: q}
}

type listFilter struct {
	Category *string
	Tag      *string
	Lineup   *time.Time
	Limit    int32
}

func (r *Repository) ListNew(ctx context.Context, f listFilter, afterTime *time.Time, afterID *uuid.UUID) ([]Card, error) {
	rows, err := r.q.ListMediaNew(ctx, db.ListMediaNewParams{
		Category: f.Category, Tag: f.Tag, LineupMonth: f.Lineup,
		CursorTime: afterTime, CursorID: afterID, Limit: f.Limit,
	})
	if err != nil {
		return nil, err
	}
	return mapRows(rows), nil
}

func (r *Repository) ListPopular(ctx context.Context, f listFilter, afterViews *int64, afterID *uuid.UUID) ([]Card, error) {
	rows, err := r.q.ListMediaPopular(ctx, db.ListMediaPopularParams{
		Category: f.Category, Tag: f.Tag, CursorViews: afterViews, CursorID: afterID, Limit: f.Limit,
	})
	if err != nil {
		return nil, err
	}
	// Ba truy vấn danh sách trả cùng các cột, nên struct sqlc sinh ra giống hệt nhau về
	// trường: Go cho phép đổi kiểu trực tiếp db.ListMediaNewRow(row), viết một hàm map là đủ.
	out := make([]Card, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCard(db.ListMediaNewRow(row)))
	}
	return out, nil
}

func (r *Repository) ListRelated(ctx context.Context, category string, exclude uuid.UUID, tags []string, limit int32) ([]Card, error) {
	rows, err := r.q.ListRelatedMedia(ctx, db.ListRelatedMediaParams{
		Category: category, ExcludeID: exclude, Tags: tags, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCard(db.ListMediaNewRow(row)))
	}
	return out, nil
}

func (r *Repository) ListFeatured(ctx context.Context, limit int32) ([]Card, error) {
	rows, err := r.q.ListFeaturedMedia(ctx, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, m := range rows {
		out = append(out, Card{
			ID: m.ID, Slug: m.Slug, Kind: m.Kind, Category: m.CategorySlug, Title: m.Title,
			Description: m.Description, GroupLabel: m.GroupLabel, GenreLabel: m.GenreLabel,
			YoutubeID: m.YoutubeID, ThumbnailURL: m.ThumbnailUrl, DurationSeconds: m.DurationSeconds,
			EpisodeCount: m.EpisodeCount, ViewCount: m.ViewCount, Featured: true, PublishedAt: m.PublishedAt,
			Channel: Channel{Slug: m.ChannelSlug, Name: m.ChannelName, Verified: m.ChannelVerified},
		})
	}
	return out, nil
}

func (r *Repository) GetBySlug(ctx context.Context, slug string) (Detail, error) {
	m, err := r.q.GetMediaBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, errNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	d := Detail{
		Card: Card{
			ID: m.ID, Slug: m.Slug, Kind: m.Kind, Category: m.CategorySlug, Title: m.Title,
			Description: m.Description, GroupLabel: m.GroupLabel, GenreLabel: m.GenreLabel,
			YoutubeID: m.YoutubeID, ThumbnailURL: m.ThumbnailUrl, DurationSeconds: m.DurationSeconds,
			EpisodeCount: m.EpisodeCount, ViewCount: m.ViewCount, Featured: m.Featured, PublishedAt: m.PublishedAt,
			Channel: Channel{
				Slug: m.ChannelSlug, Name: m.ChannelName, Verified: m.ChannelVerified, Followers: m.ChannelFollowers,
			},
		},
		Tags:         m.Tags,
		CategoryName: m.CategoryName,
	}
	if m.LineupMonth != nil {
		s := m.LineupMonth.Format("2006-01")
		d.LineupMonth = &s
	}
	return d, nil
}

func (r *Repository) IDBySlug(ctx context.Context, slug string) (uuid.UUID, error) {
	id, err := r.q.GetMediaIDBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errNotFound
	}
	return id, err
}

func (r *Repository) AddViews(ctx context.Context, id uuid.UUID, n int64) error {
	return r.q.AddMediaViews(ctx, db.AddMediaViewsParams{ID: id, Views: n})
}

func mapRows(rows []db.ListMediaNewRow) []Card {
	out := make([]Card, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCard(row))
	}
	return out
}

func toCard(m db.ListMediaNewRow) Card {
	return Card{
		ID: m.ID, Slug: m.Slug, Kind: m.Kind, Category: m.CategorySlug, Title: m.Title,
		GroupLabel: m.GroupLabel, GenreLabel: m.GenreLabel, YoutubeID: m.YoutubeID,
		ThumbnailURL: m.ThumbnailUrl, DurationSeconds: m.DurationSeconds, EpisodeCount: m.EpisodeCount,
		ViewCount: m.ViewCount, Featured: m.Featured, PublishedAt: m.PublishedAt,
		Channel: Channel{Slug: m.ChannelSlug, Name: m.ChannelName, Verified: m.ChannelVerified},
	}
}
```

- Repository là chỗ **duy nhất** biết tới kiểu sqlc (`db.ListMediaNewRow`). Service chỉ thấy `Card`.
- **`db.ListMediaNewRow(row)`**: Go cho đổi kiểu giữa hai struct có **cùng tên, cùng kiểu, cùng thứ tự
  trường**. sqlc sinh ba struct riêng cho ba truy vấn cùng cột; đổi về một kiểu thì chỉ cần một hàm `toCard`.

### Bước 4: `backend/internal/media/service.go`

```go
package media

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

const (
	defaultLimit = 24
	maxLimit     = 60
)

// slug hợp lệ: chữ thường không dấu, số, gạch ngang. Chặn ký tự lạ ngay từ đầu.
var slugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type Service struct {
	repo *Repository
	rdb  *redis.Client
}

func NewService(repo *Repository, rdb *redis.Client) *Service {
	return &Service{repo: repo, rdb: rdb}
}

type ListParams struct {
	Category string // "" = mọi chuyên mục
	Tag      string // slug chip lọc, "" = tất cả
	Sort     string // "new" (mặc định) | "popular"
	Lineup   string // "2026-10": line-up phim tháng 10/2026
	Cursor   string // next_cursor của trang trước
	Limit    int
}

// cursor là vị trí dòng cuối của trang trước. Mã hoá base64 để client coi nó là chuỗi
// "đen" (opaque), chỉ việc gửi lại, không tự ghép hay sửa.
type cursor struct {
	Time  *time.Time `json:"t,omitempty"` // sort=new
	Views *int64     `json:"v,omitempty"` // sort=popular
	ID    uuid.UUID  `json:"id"`
}

func (s *Service) List(ctx context.Context, p ListParams) (Page, error) {
	f, err := p.filter()
	if err != nil {
		return Page{}, err
	}
	cur, err := decodeCursor(p.Cursor)
	if err != nil {
		return Page{}, err
	}

	// Lấy dư 1 dòng: có dòng thứ limit+1 nghĩa là còn trang sau.
	limit := f.Limit
	f.Limit++

	var items []Card
	switch p.Sort {
	case "", "new":
		var t *time.Time
		var id *uuid.UUID
		if cur != nil {
			t, id = cur.Time, &cur.ID
		}
		items, err = s.repo.ListNew(ctx, f, t, id)
	case "popular":
		if f.Lineup != nil {
			return Page{}, apperr.Invalid("invalid_sort", "Line-up chỉ sắp xếp theo mới nhất")
		}
		var v *int64
		var id *uuid.UUID
		if cur != nil {
			v, id = cur.Views, &cur.ID
		}
		items, err = s.repo.ListPopular(ctx, f, v, id)
	default:
		return Page{}, apperr.Invalid("invalid_sort", "sort chỉ nhận new hoặc popular")
	}
	if err != nil {
		return Page{}, err
	}

	page := Page{Items: items}
	if len(items) > int(limit) {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		next := cursor{ID: last.ID}
		if p.Sort == "popular" {
			next.Views = &last.ViewCount
		} else {
			next.Time = &last.PublishedAt
		}
		page.NextCursor = encodeCursor(next)
	}
	return page, nil
}

func (s *Service) Featured(ctx context.Context, limit int32) ([]Card, error) {
	return s.repo.ListFeatured(ctx, limit)
}

func (s *Service) Get(ctx context.Context, slug string) (Detail, error) {
	if !slugRe.MatchString(slug) {
		return Detail{}, errNotFound
	}
	return s.repo.GetBySlug(ctx, slug)
}

func (s *Service) Related(ctx context.Context, slug string, limit int32) ([]Card, error) {
	d, err := s.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	return s.repo.ListRelated(ctx, d.Category, d.ID, d.Tags, limit)
}

func (p ListParams) filter() (listFilter, error) {
	var f listFilter
	if p.Category != "" {
		if !slugRe.MatchString(p.Category) {
			return f, apperr.Invalid("invalid_category", "Chuyên mục không hợp lệ")
		}
		f.Category = &p.Category
	}
	if p.Tag != "" {
		if !slugRe.MatchString(p.Tag) {
			return f, apperr.Invalid("invalid_tag", "Bộ lọc không hợp lệ")
		}
		f.Tag = &p.Tag
	}
	if p.Lineup != "" {
		t, err := time.Parse("2006-01", p.Lineup)
		if err != nil {
			return f, apperr.Invalid("invalid_lineup", "Tháng line-up phải có dạng YYYY-MM")
		}
		f.Lineup = &t
	}
	switch {
	case p.Limit <= 0:
		f.Limit = defaultLimit
	case p.Limit > maxLimit:
		f.Limit = maxLimit
	default:
		f.Limit = int32(p.Limit) //nolint:gosec // đã chặn trong khoảng 1..maxLimit
	}
	return f, nil
}

func encodeCursor(c cursor) string {
	b, _ := json.Marshal(c) // struct đơn giản, Marshal không thể lỗi
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (*cursor, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // không có con trỏ = trang đầu, không phải lỗi
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, apperr.Invalid("invalid_cursor", "Con trỏ phân trang không hợp lệ")
	}
	var c cursor
	if err := json.Unmarshal(b, &c); err != nil || c.ID == uuid.Nil {
		return nil, apperr.Invalid("invalid_cursor", "Con trỏ phân trang không hợp lệ")
	}
	return &c, nil
}
```

- **Lấy dư một dòng** (`f.Limit++`): có dòng thứ 25 nghĩa là còn trang sau, không cần câu `COUNT(*)` riêng.
- **Con trỏ là chuỗi base64 "đen"**: client chỉ gửi lại nguyên văn. Sau này đổi cấu trúc con trỏ
  (thêm trường) không làm hỏng client.
- **`slugRe`**: slug sai định dạng thì trả lỗi ngay, không tốn một truy vấn.
- **`limit` có trần 60**: không cho client xin 1 triệu dòng một lần.

### Bước 5: `backend/internal/media/handler.go`

```go
package media

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc      *Service
	log      *slog.Logger
	clientIP func(*http.Request) string
}

// clientIP: hàm lấy IP thật của khách (server.ClientIP). Truyền vào thay vì import gói server,
// để media không phụ thuộc ngược lên server.
func NewHandler(svc *Service, log *slog.Logger, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, clientIP: clientIP}
}

// GET /api/v1/media?category=xem&tag=hanh-dong&sort=new|popular&lineup=2026-10&cursor=…&limit=24
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit")) // sai hoặc thiếu → 0 → service dùng mặc định
	page, err := h.svc.List(r.Context(), ListParams{
		Category: q.Get("category"),
		Tag:      q.Get("tag"),
		Sort:     q.Get("sort"),
		Lineup:   q.Get("lineup"),
		Cursor:   q.Get("cursor"),
		Limit:    limit,
	})
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, page)
}

// GET /api/v1/media/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	d, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, d)
}

// GET /api/v1/media/{slug}/related
func (h *Handler) Related(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.Related(r.Context(), chi.URLParam(r, "slug"), 12)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, items)
}

// POST /api/v1/media/{slug}/views — frontend gọi khi bắt đầu phát.
func (h *Handler) RecordView(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.RecordView(r.Context(), chi.URLParam(r, "slug"), h.clientIP(r)); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}
```

Handler mỏng: đọc tham số, gọi service, ghi phản hồi. Không có `if` nghiệp vụ nào.

`clientIP` được **truyền vào** dưới dạng hàm, không import gói `server`: `server` đã import `media`
(để gắn route), nếu `media` import ngược lại `server` thì Go báo lỗi vòng lặp import.

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

Gọi API ở bài 2.07.

```bash
git add . && git commit -m "Module media: danh sách, chi tiết, liên quan"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `import cycle not allowed` | Gói con import ngược gói cha. Truyền hàm/interface vào thay vì import |
| Trang 2 lặp dòng của trang 1 | `ORDER BY` thiếu `id`, hoặc so sánh con trỏ không dùng cặp `(published_at, id)` |
| `cannot convert row (type ListMediaPopularRow) to type ListMediaNewRow` | Hai truy vấn trả cột khác nhau (thứ tự/kiểu). Sửa SQL cho giống hệt |
