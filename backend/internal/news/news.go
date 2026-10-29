// Package news: tin tức (Khám phá, Sự kiện, Mẹo bay, Line-up phim, Kinh doanh).
//
// Cấu trúc giống module media nhưng gọn hơn: không cần tầng repository riêng vì không có truy
// vấn nào phải gộp hay đổi kiểu phức tạp; service gọi thẳng code sqlc.
package news

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	defaultLimit = 12
	maxLimit     = 48
)

var (
	slugRe      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	errNotFound = apperr.NotFound("news_not_found", "Không tìm thấy bài viết")
)

type Category struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Card: bài viết trong danh sách (không có thân bài).
type Card struct {
	ID           uuid.UUID `json:"id"`
	Slug         string    `json:"slug"`
	Category     string    `json:"category"`
	CategoryName string    `json:"category_name"`
	Title        string    `json:"title"`
	Excerpt      string    `json:"excerpt"`
	CoverURL     string    `json:"cover_url"`
	Author       string    `json:"author"`
	PublishedAt  time.Time `json:"published_at"`
}

// Article: trang đọc một bài. BodyHTML đã được lọc lúc ghi (pkg/sanitize).
type Article struct {
	Card
	BodyHTML  string    `json:"body_html"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Page struct {
	Items      []Card `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

type cursor struct {
	Time time.Time `json:"t"`
	ID   uuid.UUID `json:"id"`
}

type Service struct {
	q   *db.Queries
	rdb *redis.Client
}

func NewService(q *db.Queries, rdb *redis.Client) *Service {
	return &Service{q: q, rdb: rdb}
}

func (s *Service) Categories(ctx context.Context) ([]Category, error) {
	return cache.Remember(ctx, s.rdb, "cache:news-categories", 10*time.Minute, func(ctx context.Context) ([]Category, error) {
		rows, err := s.q.ListNewsCategories(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]Category, 0, len(rows))
		for _, r := range rows {
			out = append(out, Category{Slug: r.Slug, Name: r.Name, Description: r.Description})
		}
		return out, nil
	})
}

func (s *Service) List(ctx context.Context, category, cursorStr string, limit int) (Page, error) {
	params := db.ListNewsParams{Limit: clampLimit(limit) + 1} // dư 1 dòng để biết còn trang sau
	if category != "" {
		if !slugRe.MatchString(category) {
			return Page{}, apperr.Invalid("invalid_category", "Chuyên mục không hợp lệ")
		}
		params.Category = &category
	}
	var cur cursor
	ok, err := pagination.Decode(cursorStr, &cur)
	if err != nil {
		return Page{}, err
	}
	if ok {
		params.CursorTime, params.CursorID = &cur.Time, &cur.ID
	}

	rows, err := s.q.ListNews(ctx, params)
	if err != nil {
		return Page{}, err
	}
	items := make([]Card, 0, len(rows))
	for _, r := range rows {
		items = append(items, toCard(r))
	}

	page := Page{Items: items}
	if len(items) == int(params.Limit) {
		page.Items = items[:len(items)-1]
		last := page.Items[len(page.Items)-1]
		page.NextCursor = pagination.Encode(cursor{Time: last.PublishedAt, ID: last.ID})
	}
	return page, nil
}

func (s *Service) Get(ctx context.Context, slug string) (Article, error) {
	if !slugRe.MatchString(slug) {
		return Article{}, errNotFound
	}
	r, err := s.q.GetNewsBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Article{}, errNotFound
	}
	if err != nil {
		return Article{}, err
	}
	return Article{
		Card: Card{
			ID: r.ID, Slug: r.Slug, Category: r.CategorySlug, CategoryName: r.CategoryName,
			Title: r.Title, Excerpt: r.Excerpt, CoverURL: r.CoverUrl, Author: r.Author,
			PublishedAt: r.PublishedAt,
		},
		BodyHTML:  r.BodyHtml,
		UpdatedAt: r.UpdatedAt,
	}, nil
}

func (s *Service) Related(ctx context.Context, slug string, limit int32) ([]Card, error) {
	a, err := s.Get(ctx, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListRelatedNews(ctx, db.ListRelatedNewsParams{
		ExcludeID: a.ID, Category: a.Category, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCard(db.ListNewsRow(r)))
	}
	return out, nil
}

func toCard(r db.ListNewsRow) Card {
	return Card{
		ID: r.ID, Slug: r.Slug, Category: r.CategorySlug, CategoryName: r.CategoryName,
		Title: r.Title, Excerpt: r.Excerpt, CoverURL: r.CoverUrl, Author: r.Author,
		PublishedAt: r.PublishedAt,
	}
}

func clampLimit(n int) int32 {
	switch {
	case n <= 0:
		return defaultLimit
	case n > maxLimit:
		return maxLimit
	default:
		return int32(n) //nolint:gosec // đã chặn trong khoảng 1..maxLimit
	}
}
