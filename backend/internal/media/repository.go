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
	Channel  *string
	Limit    int32
}

func (r *Repository) ListNew(ctx context.Context, f listFilter, afterTime *time.Time, afterID *uuid.UUID) ([]Card, error) {
	rows, err := r.q.ListMediaNew(ctx, db.ListMediaNewParams{
		Category: f.Category, Tag: f.Tag, LineupMonth: f.Lineup, Channel: f.Channel,
		CursorTime: afterTime, CursorID: afterID, Limit: f.Limit,
	})
	if err != nil {
		return nil, err
	}
	return mapRows(rows), nil
}

func (r *Repository) ListPopular(ctx context.Context, f listFilter, afterViews *int64, afterID *uuid.UUID) ([]Card, error) {
	rows, err := r.q.ListMediaPopular(ctx, db.ListMediaPopularParams{
		Category: f.Category, Tag: f.Tag, Channel: f.Channel,
		CursorViews: afterViews, CursorID: afterID, Limit: f.Limit,
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

// LineupMonths: các tháng có line-up phim, mới nhất trước.
func (r *Repository) LineupMonths(ctx context.Context) ([]time.Time, error) {
	return r.q.ListLineupMonths(ctx)
}
