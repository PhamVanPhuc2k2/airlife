# Bài 3.03: Dữ liệu mẫu tin tức, lọc HTML ngay trong seed

> [← Bài trước](02-schema-tin-tuc.md) · [Mục lục](../README.md) · [Bài sau →](04-module-news.md)

## Mục tiêu

`make seed` nạp thêm 5 chuyên mục tin, 8 bài viết. Thân bài đi qua `sanitize.ArticleHTML`, và một thẻ
`<script>` cố ý cài trong dữ liệu mẫu bị lọc mất.

## Bạn sẽ học

- **Mọi** đường ghi HTML đều phải lọc, kể cả dữ liệu mẫu do chính mình viết.
- Kiểm tra một biện pháp bảo mật bằng cách cố ý đưa dữ liệu xấu vào.

## Viết code

### Bước 1: Dữ liệu

`backend/cmd/seed/data.json` có thêm `news_categories` và `news`, chuyển từ mockup. Mockup chỉ có tiêu
đề, tóm tắt, ngày; thân bài là **một đoạn mẫu dùng chung cho mọi bài** (trang `bai-viet.html` của
mockup), giữ nguyên làm dữ liệu dev. Cuối đoạn mẫu có thêm:

```html
<script>alert('XSS: dòng này phải bị lọc khi seed')</script>
```

```bash
lay backend/cmd/seed/data.json
```

### Bước 2: `backend/cmd/seed/main.go`

Thêm hai trường `NewsCategories`, `News` vào struct `seedData`, và vòng nạp tin trước `tx.Commit`.
Bản đầy đủ:

```go
// Command seed nạp dữ liệu mẫu (cmd/seed/data.json) vào database dev.
//
// Chạy nhiều lần không sao: mọi câu lệnh là upsert theo slug. Từ chối chạy khi
// APP_ENV=production để không ghi dữ liệu mẫu đè lên dữ liệu thật.
//
//	make seed
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/sanitize"
)

// Chỉ thị go:embed bên dưới nhúng file vào binary lúc build: chạy seed ở đâu cũng có dữ liệu, không cần
// chép data.json đi kèm.
//
//go:embed data.json
var seedJSON []byte

type seedData struct {
	Categories []struct {
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Icon        string `json:"icon"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Filters     []struct {
			Slug string `json:"slug"`
			Name string `json:"name"`
		} `json:"filters"`
	} `json:"categories"`
	Channels []struct {
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Type        string `json:"type"`
		Verified    bool   `json:"verified"`
		Followers   int64  `json:"followers"`
		Description string `json:"description"`
	} `json:"channels"`
	Media []struct {
		Slug            string   `json:"slug"`
		Kind            string   `json:"kind"`
		Category        string   `json:"category"`
		Channel         string   `json:"channel"`
		Title           string   `json:"title"`
		Description     string   `json:"description"`
		Group           string   `json:"group"`
		Genre           string   `json:"genre"`
		Tags            []string `json:"tags"`
		YoutubeID       *string  `json:"youtube_id"`
		DurationSeconds *int32   `json:"duration_seconds"`
		EpisodeCount    *int32   `json:"episode_count"`
		Views           int64    `json:"views"`
		Featured        bool     `json:"featured"`
		Lineup          bool     `json:"lineup"`
		PublishedDays   float64  `json:"published_days_ago"`
	} `json:"media"`
	NewsCategories []struct {
		Slug        string `json:"slug"`
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"news_categories"`
	News []struct {
		Slug        string    `json:"slug"`
		Category    string    `json:"category"`
		Title       string    `json:"title"`
		Excerpt     string    `json:"excerpt"`
		BodyHTML    string    `json:"body_html"`
		PublishedAt time.Time `json:"published_at"`
	} `json:"news"`
}

func main() {
	if err := run(); err != nil {
		slog.Error("seed lỗi", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.Log.Level, cfg.Log.Format)
	if cfg.IsProduction() {
		return errors.New("không chạy seed trên production")
	}

	var data seedData
	if err := json.Unmarshal(seedJSON, &data); err != nil {
		return fmt.Errorf("đọc data.json: %w", err)
	}

	ctx := context.Background()
	pool, err := database.NewPostgres(ctx, cfg.Postgres.URL, 2)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Một transaction: lỗi giữa chừng thì không ghi gì cả, không để database nửa vời.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }() // đã Commit thì Rollback không làm gì
	q := db.New(tx)

	for i, c := range data.Categories {
		if err := q.UpsertCategory(ctx, db.UpsertCategoryParams{
			Slug: c.Slug, Name: c.Name, Icon: c.Icon, Title: c.Title,
			Description: c.Description, SortOrder: int16(i), //nolint:gosec // vài phần tử, không tràn
		}); err != nil {
			return fmt.Errorf("chuyên mục %s: %w", c.Slug, err)
		}
		for j, f := range c.Filters {
			if err := q.UpsertCategoryFilter(ctx, db.UpsertCategoryFilterParams{
				CategorySlug: c.Slug, Slug: f.Slug, Name: f.Name, SortOrder: int16(j), //nolint:gosec // như trên
			}); err != nil {
				return fmt.Errorf("chip %s/%s: %w", c.Slug, f.Slug, err)
			}
		}
	}

	channelIDs := make(map[string]uuid.UUID, len(data.Channels))
	for _, c := range data.Channels {
		id, err := q.UpsertChannel(ctx, db.UpsertChannelParams{
			Slug: c.Slug, Name: c.Name, Type: c.Type, Verified: c.Verified,
			FollowersCount: c.Followers, Description: c.Description,
		})
		if err != nil {
			return fmt.Errorf("kênh %s: %w", c.Slug, err)
		}
		channelIDs[c.Slug] = id
	}

	now := time.Now().UTC()
	thisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	for _, m := range data.Media {
		channelID, ok := channelIDs[m.Channel]
		if !ok {
			return fmt.Errorf("media %s: không có kênh %q", m.Slug, m.Channel)
		}
		var lineup *time.Time
		if m.Lineup {
			lineup = &thisMonth
		}
		params := db.UpsertMediaParams{
			Slug: m.Slug, Kind: m.Kind, CategorySlug: m.Category, Title: m.Title,
			ChannelID: channelID, Description: m.Description, GroupLabel: m.Group,
			GenreLabel: m.Genre, Tags: m.Tags,
			YoutubeID: m.YoutubeID,
			// Ảnh minh hoạ cố định theo slug (giống mockup). Có video YouTube thật thì dùng
			// ảnh của YouTube: https://i.ytimg.com/vi/<youtube_id>/hqdefault.jpg
			ThumbnailUrl:    "https://picsum.photos/seed/airlife-" + m.Slug + "/640/360",
			DurationSeconds: m.DurationSeconds, EpisodeCount: m.EpisodeCount,
			ViewCount: m.Views, Featured: m.Featured, LineupMonth: lineup,
			PublishedAt: now.Add(-time.Duration(m.PublishedDays * float64(24*time.Hour))),
		}
		if err := q.UpsertMedia(ctx, params); err != nil {
			return fmt.Errorf("media %s: %w", m.Slug, err)
		}
	}

	for i, c := range data.NewsCategories {
		if err := q.UpsertNewsCategory(ctx, db.UpsertNewsCategoryParams{
			Slug: c.Slug, Name: c.Name, Description: c.Description, SortOrder: int16(i), //nolint:gosec // vài phần tử
		}); err != nil {
			return fmt.Errorf("chuyên mục tin %s: %w", c.Slug, err)
		}
	}
	for _, n := range data.News {
		if err := q.UpsertNews(ctx, db.UpsertNewsParams{
			Slug: n.Slug, CategorySlug: n.Category, Title: n.Title, Excerpt: n.Excerpt,
			// Lọc HTML trước khi ghi, kể cả dữ liệu mẫu: mọi đường ghi thân bài đều qua sanitize.
			BodyHtml:    sanitize.ArticleHTML(n.BodyHTML),
			CoverUrl:    "https://picsum.photos/seed/airlife-news-" + n.Slug + "/1200/640",
			Author:      "Airlife",
			PublishedAt: n.PublishedAt,
		}); err != nil {
			return fmt.Errorf("tin %s: %w", n.Slug, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Info("đã nạp dữ liệu mẫu",
		"categories", len(data.Categories), "channels", len(data.Channels), "media", len(data.Media),
		"news", len(data.News))
	return nil
}
```

- **`sanitize.ArticleHTML(n.BodyHTML)`**: dữ liệu mẫu do mình viết, nhưng vẫn lọc. Quy tắc "mọi đường
  ghi `body_html` đều qua sanitize" chỉ có giá trị khi **không có ngoại lệ**.
- **`PublishedAt time.Time`** đọc thẳng chuỗi `"2026-10-20T09:00:00+07:00"` trong JSON: Go tự hiểu định dạng
  RFC 3339.

## Kiểm tra

```bash
make seed
# msg="đã nạp dữ liệu mẫu" categories=4 channels=7 media=21 news=8
docker compose exec postgres psql -U airlife -c \
  "SELECT count(*), bool_or(body_html LIKE '%<script%') AS con_script FROM news;"
#  count | con_script
#      8 | f
```

`con_script = f`: không bài nào còn thẻ `<script>`.

```bash
git add . && git commit -m "Dữ liệu mẫu tin tức"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `parsing time ... cannot parse` | Ngày trong JSON phải đủ dạng `2026-10-20T09:00:00+07:00` |
| `con_script = t` | Seed ghi `n.BodyHTML` thẳng, quên `sanitize.ArticleHTML` |
