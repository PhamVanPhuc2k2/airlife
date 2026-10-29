package media

import (
	"context"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
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
	Channel  string // slug kênh: nội dung của một kênh (trang kênh)
	Cursor   string // next_cursor của trang trước
	Limit    int
}

// cursor là vị trí dòng cuối của trang trước (mã hoá bằng pkg/pagination).
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
	var cur cursor
	hasCur, err := pagination.Decode(p.Cursor, &cur)
	if err != nil {
		return Page{}, err
	}
	if hasCur && cur.ID == uuid.Nil {
		return Page{}, apperr.Invalid("invalid_cursor", "Con trỏ phân trang không hợp lệ")
	}

	// Lấy dư 1 dòng: có dòng thứ limit+1 nghĩa là còn trang sau.
	limit := f.Limit
	f.Limit++

	var items []Card
	switch p.Sort {
	case "", "new":
		var t *time.Time
		var id *uuid.UUID
		if hasCur {
			t, id = cur.Time, &cur.ID
		}
		items, err = s.repo.ListNew(ctx, f, t, id)
	case "popular":
		if f.Lineup != nil {
			return Page{}, apperr.Invalid("invalid_sort", "Line-up chỉ sắp xếp theo mới nhất")
		}
		var v *int64
		var id *uuid.UUID
		if hasCur {
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
		page.NextCursor = pagination.Encode(next)
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

// LineupMonths trả các tháng có line-up phim dạng "2026-10", mới nhất trước.
func (s *Service) LineupMonths(ctx context.Context) ([]string, error) {
	months, err := s.repo.LineupMonths(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(months))
	for _, m := range months {
		out = append(out, m.Format("2006-01"))
	}
	return out, nil
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
	if p.Channel != "" {
		if !slugRe.MatchString(p.Channel) {
			return f, apperr.Invalid("invalid_channel", "Kênh không hợp lệ")
		}
		f.Channel = &p.Channel
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
