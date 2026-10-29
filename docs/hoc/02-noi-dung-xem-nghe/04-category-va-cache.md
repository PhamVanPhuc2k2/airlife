# Bài 2.04: Module chuyên mục và cache Redis

> [← Bài trước](03-du-lieu-mau-seed.md) · [Mục lục](../README.md) · [Bài sau →](05-module-media.md)

## Mục tiêu

`GET /api/v1/categories` và `GET /api/v1/categories/{slug}`, đọc qua cache Redis 10 phút.

## Bạn sẽ học

- Mẫu **cache-aside** và hàm generic `Remember[T]`.
- Nguyên tắc: Redis sập thì site **chậm đi**, không được **chết**.
- Đổi `pgx.ErrNoRows` thành lỗi nghiệp vụ `NotFound`.

## Viết code

### Bước 1: `backend/pkg/cache/json.go`

```go
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Remember là mẫu "cache-aside": tìm trong Redis trước; không có thì gọi load (đọc database),
// lưu kết quả vào Redis với thời hạn ttl, rồi trả về.
//
// Redis lỗi (sập, mất kết nối) thì KHÔNG làm hỏng request: ghi log rồi đọc thẳng database.
// Cache chỉ để nhanh hơn, không được là điểm chết của hệ thống.
func Remember[T any](
	ctx context.Context, rdb *redis.Client, key string, ttl time.Duration,
	load func(context.Context) (T, error),
) (T, error) {
	var v T
	b, err := rdb.Get(ctx, key).Bytes()
	switch {
	case err == nil:
		if json.Unmarshal(b, &v) == nil {
			return v, nil
		}
		// Dữ liệu cache hỏng (đổi cấu trúc struct sau khi deploy…): bỏ qua, đọc lại.
	case !errors.Is(err, redis.Nil): // redis.Nil = không có khoá, là bình thường
		slog.WarnContext(ctx, "đọc cache lỗi", "key", key, "err", err)
	}

	v, err = load(ctx)
	if err != nil {
		return v, err
	}
	if b, err := json.Marshal(v); err == nil {
		if err := rdb.Set(ctx, key, b, ttl).Err(); err != nil {
			slog.WarnContext(ctx, "ghi cache lỗi", "key", key, "err", err)
		}
	}
	return v, nil
}
```

- **Generic `[T any]`**: một hàm dùng cho mọi kiểu dữ liệu: `Remember[[]Category]`, `Remember[Home]`…
  Go tự suy ra `T` từ hàm `load`.
- **`redis.Nil`**: không có khoá, trường hợp bình thường (cache trống). Lỗi khác mới là Redis có vấn đề.
- **Không cache lỗi**: `load` lỗi thì trả lỗi luôn, lần sau thử lại.
- **Lưu JSON**: dễ xem bằng `redis-cli GET cache:categories`.

### Bước 2: `backend/internal/category/category.go`

Module nhỏ (2 API, không có nghiệp vụ phức tạp) nên gộp một file. Không phải module nào cũng cần đủ
4 file `handler/service/repository/dto`; tách khi file dài ra.

```go
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
```

- **`errors.Is(err, pgx.ErrNoRows)`** → `apperr.NotFound`: client nhận 404 với `code: category_not_found`,
  không phải 500.
- **`chi.URLParam(r, "slug")`**: lấy `{slug}` trong đường dẫn `/categories/{slug}`.
- Route được gắn ở bài 2.07, cùng các module khác.

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

Gọi API thật ở bài 2.07.

```bash
git add . && git commit -m "Module chuyên mục, cache Redis"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Sửa dữ liệu trong DB mà API vẫn trả cũ | Đang trong 10 phút cache. Xoá: `docker compose exec redis redis-cli -a airlife DEL cache:categories` |
| Trang chết khi tắt Redis | Đang `return err` khi đọc cache lỗi. Cache lỗi phải bỏ qua, đọc database |
