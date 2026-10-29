// Package category: chuyên mục (xem, nghe, kinh-doanh, tour-bay) và chip lọc của chúng.
//
// Module nhỏ nên gộp repository, service, handler trong một file. Module lớn hơn (media)
// tách thành nhiều file theo tầng.
package category

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Chuyên mục gần như không đổi: cache lâu.
const cacheTTL = 10 * time.Minute

type Category struct {
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Icon        string   `json:"icon"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Filters     []Filter `json:"filters,omitempty"`
}

type Filter struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type Service struct {
	q   *db.Queries
	rdb *redis.Client
}

func NewService(q *db.Queries, rdb *redis.Client) *Service {
	return &Service{q: q, rdb: rdb}
}

func (s *Service) List(ctx context.Context) ([]Category, error) {
	return cache.Remember(ctx, s.rdb, "cache:categories", cacheTTL, func(ctx context.Context) ([]Category, error) {
		rows, err := s.q.ListCategories(ctx)
		if err != nil {
			return nil, err
		}
		out := make([]Category, 0, len(rows))
		for _, r := range rows {
			out = append(out, Category{
				Slug: r.Slug, Name: r.Name, Icon: r.Icon, Title: r.Title, Description: r.Description,
			})
		}
		return out, nil
	})
}

func (s *Service) Get(ctx context.Context, slug string) (Category, error) {
	return cache.Remember(ctx, s.rdb, "cache:category:"+slug, cacheTTL, func(ctx context.Context) (Category, error) {
		r, err := s.q.GetCategory(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return Category{}, apperr.NotFound("category_not_found", "Không tìm thấy chuyên mục")
		}
		if err != nil {
			return Category{}, err
		}
		filters, err := s.q.ListCategoryFilters(ctx, slug)
		if err != nil {
			return Category{}, err
		}
		c := Category{Slug: r.Slug, Name: r.Name, Icon: r.Icon, Title: r.Title, Description: r.Description}
		c.Filters = make([]Filter, 0, len(filters))
		for _, f := range filters {
			c.Filters = append(c.Filters, Filter{Slug: f.Slug, Name: f.Name})
		}
		return c, nil
	})
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /api/v1/categories
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cats, err := h.svc.List(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, cats)
}

// GET /api/v1/categories/{slug}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	c, err := h.svc.Get(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, c)
}
