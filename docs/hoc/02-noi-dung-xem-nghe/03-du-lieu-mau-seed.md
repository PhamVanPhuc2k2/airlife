# Bài 2.03: Dữ liệu mẫu và `cmd/seed`

> [← Bài trước](02-sqlc.md) · [Mục lục](../README.md) · [Bài sau →](04-category-va-cache.md)

## Mục tiêu

`make seed` nạp 4 chuyên mục, 7 kênh, 21 media từ mockup vào database dev. Chạy lại nhiều lần không
bị trùng.

## Bạn sẽ học

- Chương trình thứ ba trong `cmd/`: công cụ dòng lệnh dùng chung code với api.
- `go:embed`: nhúng file dữ liệu vào binary.
- Transaction: lỗi giữa chừng thì không ghi gì cả.

## Viết code

### Bước 1: `backend/cmd/seed/data.json`

Dữ liệu chuyển từ `skyline/data/content.json` của mockup:
- Đổi tên Skyline → Airlife.
- Thời lượng `"2:08:14"` → `7694` giây, `"10 tập"` → `episode_count: 10`.
- "2 ngày trước" → `published_days_ago: 2`.
- Slug không dấu từ tiêu đề, tags từ nhóm + thể loại.

File dữ liệu, **chép, không gõ**:

```bash
lay backend/cmd/seed/data.json
```

Media **chưa có `youtube_id`**: mockup không có video thật, và không tự bịa ID YouTube. Ảnh minh hoạ
dùng picsum.photos như mockup. Khi có link video thật, gắn bằng SQL (trang quản trị ở Phần 12):

```sql
UPDATE media SET youtube_id = 'XXXXXXXXXXX',
       thumbnail_url = 'https://i.ytimg.com/vi/XXXXXXXXXXX/hqdefault.jpg'
WHERE slug = 'vung-troi-cuoi-cung';
```

### Bước 2: `backend/cmd/seed/main.go`

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

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Info("đã nạp dữ liệu mẫu",
		"categories", len(data.Categories), "channels", len(data.Channels), "media", len(data.Media))
	return nil
}
```

Điểm chính:

- **`//go:embed data.json`** (viết liền, không có dấu cách sau `//`): chỉ thị cho trình biên dịch
  nhúng file vào biến `seedJSON`. Viết `// go:embed` (có dấu cách) thì thành comment thường, biến
  rỗng; linter `staticcheck` bắt được lỗi này (SA9009). Bản thân dự án đã dính lỗi đó lúc viết comment
  phía trên.
- **`pool.Begin` → `db.New(tx)`**: code sqlc chạy được trên cả pool lẫn transaction. Mọi câu lệnh
  trong `tx` chỉ thật sự ghi khi `Commit`.
- **`defer tx.Rollback`**: nếu `return err` giữa chừng, Rollback huỷ mọi thứ. Đã Commit rồi thì
  Rollback không làm gì, nên luôn `defer` được.
- **Từ chối chạy trên production**.
- **`//nolint:gosec`**: `int16(i)` có thể tràn số nếu `i` lớn; ở đây chỉ vài phần tử, nên tắt cảnh báo
  **kèm lý do**.

## Kiểm tra

```bash
make seed
# msg="đã nạp dữ liệu mẫu" categories=4 channels=7 media=21
make seed      # chạy lại: vẫn 21 media, không lỗi trùng
make psql
```

```sql
SELECT category_slug, count(*), sum(view_count) FROM media GROUP BY 1;
--  xem  | 13 | 13692000
--  nghe |  8 |  3122000
SELECT slug, tags, duration_seconds, episode_count FROM media LIMIT 3;
\q
```

```bash
git add . && git commit -m "Dữ liệu mẫu và cmd/seed"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `pattern data.json: no matching files found` | `data.json` phải nằm cùng thư mục với `main.go` |
| `violates check constraint "media_check"` | Một media có cả `duration_seconds` lẫn `episode_count` (hoặc thiếu cả hai) |
| `insert or update on table "media" violates foreign key constraint` | Media trỏ tới kênh/chuyên mục chưa có. Thứ tự nạp: chuyên mục → kênh → media |
