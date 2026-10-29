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
