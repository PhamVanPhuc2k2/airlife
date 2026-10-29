// Command seed nạp dữ liệu mẫu (cmd/seed/data.json) vào database dev.
//
// Chạy nhiều lần không sao: mọi câu lệnh là upsert theo slug. Từ chối chạy khi
// APP_ENV=production để không ghi dữ liệu mẫu đè lên dữ liệu thật.
//
//	make seed
package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
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
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/password"
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
	Products []struct {
		Slug            string   `json:"slug"`
		Kind            string   `json:"kind"`
		Category        string   `json:"category"`
		Tag             string   `json:"tag"`
		Channel         string   `json:"channel"`
		Name            string   `json:"name"`
		Description     string   `json:"description"`
		BodyHTML        string   `json:"body_html"`
		Price           int64    `json:"price"`
		OldPrice        *int64   `json:"old_price"`
		Rating          float64  `json:"rating"`
		RatingCount     int32    `json:"rating_count"`
		Sold            int32    `json:"sold"`
		PublishedDays   float64  `json:"published_days_ago"`
		DeliveryMethods []string `json:"delivery_methods"`
		Media           []string `json:"media"` // slug các video có sản phẩm này
		Variants        []struct {
			Label    string `json:"label"`
			Price    int64  `json:"price"`
			OldPrice *int64 `json:"old_price"`
			Stock    int32  `json:"stock"`
		} `json:"variants"`
	} `json:"products"`
	Users []struct {
		Key         string `json:"key"`
		DisplayName string `json:"display_name"`
	} `json:"users"`
	Comments []struct {
		Key      string  `json:"key"`
		Parent   string  `json:"parent"`
		User     string  `json:"user"`
		Media    string  `json:"media"`
		Body     string  `json:"body"`
		Likes    int32   `json:"likes"`
		HoursAgo float64 `json:"hours_ago"`
	} `json:"comments"`
}

// Id cố định cho bình luận mẫu: uuid v5 sinh từ khoá ("c1", "r2"…). Cùng khoá luôn ra cùng id,
// nên chạy seed lại thì cập nhật đúng bình luận cũ thay vì thêm bản sao.
var seedNamespace = uuid.MustParse("6f1c2b9e-5a0d-4c3e-9b7a-2d4e8f1a3c5b")

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

	if err := seedProducts(ctx, q, data, channelIDs, now); err != nil {
		return err
	}
	if err := seedComments(ctx, q, data, now); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Info("đã nạp dữ liệu mẫu",
		"categories", len(data.Categories), "channels", len(data.Channels), "media", len(data.Media),
		"news", len(data.News), "products", len(data.Products), "users", len(data.Users), "comments", len(data.Comments))
	return nil
}

// seedProducts nạp sản phẩm, biến thể và liên kết sản phẩm trong video (Phần 07).
func seedProducts(ctx context.Context, q *db.Queries, data seedData, channelIDs map[string]uuid.UUID, now time.Time) error {
	for _, p := range data.Products {
		channelID, ok := channelIDs[p.Channel]
		if !ok {
			return fmt.Errorf("sản phẩm %s: không có kênh %q", p.Slug, p.Channel)
		}
		img := func(n int) string {
			return fmt.Sprintf("https://picsum.photos/seed/airlife-%s-%d/800/800", p.Slug, n)
		}
		id, err := q.UpsertProduct(ctx, db.UpsertProductParams{
			Slug: p.Slug, Kind: p.Kind, CategorySlug: p.Category, Tag: p.Tag, ChannelID: channelID,
			Name: p.Name, Description: p.Description, BodyHtml: sanitize.ArticleHTML(p.BodyHTML),
			ImageUrl: img(1), Gallery: []string{img(2), img(3), img(4)},
			Price: p.Price, OldPrice: p.OldPrice, DeliveryMethods: p.DeliveryMethods,
			Rating: p.Rating, RatingCount: p.RatingCount, SoldCount: p.Sold,
			PublishedAt: now.Add(-time.Duration(p.PublishedDays * float64(24*time.Hour))),
		})
		if err != nil {
			return fmt.Errorf("sản phẩm %s: %w", p.Slug, err)
		}
		for i, v := range p.Variants {
			if err := q.UpsertProductVariant(ctx, db.UpsertProductVariantParams{
				ProductID: id, Sku: fmt.Sprintf("%s-%d", p.Slug, i+1), Label: v.Label,
				Price: v.Price, OldPrice: v.OldPrice, Stock: v.Stock,
				SortOrder: int16(i), //nolint:gosec // vài biến thể, không tràn
			}); err != nil {
				return fmt.Errorf("biến thể %s/%s: %w", p.Slug, v.Label, err)
			}
		}
		for i, slug := range p.Media {
			mediaID, err := q.GetMediaIDBySlug(ctx, slug)
			if err != nil {
				return fmt.Errorf("sản phẩm %s: video %q: %w", p.Slug, slug, err)
			}
			if err := q.UpsertMediaProduct(ctx, db.UpsertMediaProductParams{
				MediaID: mediaID, ProductID: id, SortOrder: int16(i), //nolint:gosec // như trên
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// seedComments nạp người dùng mẫu và bình luận mẫu (Phần 05).
func seedComments(ctx context.Context, q *db.Queries, data seedData, now time.Time) error {
	userIDs := make(map[string]uuid.UUID, len(data.Users))
	for _, u := range data.Users {
		// Mật khẩu là chuỗi ngẫu nhiên không ai biết: tài khoản mẫu chỉ để làm người viết bình
		// luận, không đăng nhập được.
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			return err
		}
		hash, err := password.Hash(hex.EncodeToString(random))
		if err != nil {
			return err
		}
		id, err := q.UpsertSeedUser(ctx, db.UpsertSeedUserParams{
			Email: "seed-" + u.Key + "@airlife.local", PasswordHash: hash, DisplayName: u.DisplayName,
		})
		if err != nil {
			return fmt.Errorf("người dùng mẫu %s: %w", u.Key, err)
		}
		userIDs[u.Key] = id
	}

	// Đếm số trả lời thật của mỗi bình luận gốc
	replies := map[string]int32{}
	for _, c := range data.Comments {
		if c.Parent != "" {
			replies[c.Parent]++
		}
	}
	commentID := func(key string) uuid.UUID { return uuid.NewSHA1(seedNamespace, []byte("comment:"+key)) }

	// Bình luận gốc trước, trả lời sau (trả lời tham chiếu tới bình luận gốc)
	for _, pass := range []bool{false, true} {
		for _, c := range data.Comments {
			if (c.Parent != "") != pass {
				continue
			}
			mediaID, err := q.GetMediaIDBySlug(ctx, c.Media)
			if err != nil {
				return fmt.Errorf("bình luận %s: media %q: %w", c.Key, c.Media, err)
			}
			var parent *uuid.UUID
			if c.Parent != "" {
				p := commentID(c.Parent)
				parent = &p
			}
			if err := q.UpsertSeedComment(ctx, db.UpsertSeedCommentParams{
				ID: commentID(c.Key), MediaID: &mediaID, ParentID: parent, UserID: userIDs[c.User],
				Body: c.Body, LikeCount: c.Likes, ReplyCount: replies[c.Key],
				CreatedAt: now.Add(-time.Duration(c.HoursAgo * float64(time.Hour))),
			}); err != nil {
				return fmt.Errorf("bình luận %s: %w", c.Key, err)
			}
		}
	}
	return nil
}
