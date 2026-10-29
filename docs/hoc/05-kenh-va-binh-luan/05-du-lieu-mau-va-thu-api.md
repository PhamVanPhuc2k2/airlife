# Bài 5.05: Dữ liệu mẫu và thử toàn bộ API

> [← Bài trước](04-api-va-trang-chu.md) · [Mục lục](../README.md) · [Bài sau →](06-frontend-kenh-va-theo-doi.md)

## Mục tiêu

- Seed nạp 8 người dùng mẫu và 10 bình luận (6 bình luận gốc, 4 trả lời) lấy từ mockup.
- Thử mọi API kênh và bình luận bằng curl.

## Bạn sẽ học

- Id cố định bằng uuid v5 để seed chạy lại không nhân đôi dữ liệu.
- Tài khoản mẫu không đăng nhập được (mật khẩu ngẫu nhiên).
- Thử các trường hợp xấu: bấm hai lần, sửa id trên URL, spam.

## Viết code

### Bước 1: Truy vấn seed

Thêm vào cuối `backend/internal/db/queries/seed.sql`:

```sql
-- Người dùng mẫu (bình luận mẫu cần người viết). Đánh dấu đã xác minh email.
-- name: UpsertSeedUser :one
INSERT INTO users (email, password_hash, display_name, email_verified_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
RETURNING id;

-- Bình luận mẫu có id cố định (uuid sinh từ khoá trong data.json): chạy seed lại không bị nhân đôi.
-- name: UpsertSeedComment :exec
INSERT INTO comments (id, media_id, news_id, parent_id, user_id, body, like_count, reply_count, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE
SET body = EXCLUDED.body, like_count = EXCLUDED.like_count, reply_count = EXCLUDED.reply_count;
```

```bash
make sqlc
```

### Bước 2: Dữ liệu, `backend/cmd/seed/data.json`

Thêm hai mảng `users` và `comments` vào cuối file (sau `news`). Tên người và câu bình luận lấy từ
`skyline/data/content.json`; bình luận về sản phẩm của mockup bỏ qua (sản phẩm làm ở Phần 07). Trả lời
(`r1`…`r4`) là câu mẫu tự viết, có `parent` trỏ tới khoá bình luận gốc:

```json
  "users": [
    { "key": "u1", "display_name": "Minh Anh" },
    { "key": "u2", "display_name": "Hoàng Long" }
  ],
  "comments": [
    {
      "key": "c1",
      "user": "u1",
      "media": "vung-troi-cuoi-cung",
      "body": "Xem trọn bộ trên chuyến SGN – HAN mà quên luôn giờ hạ cánh. Cảnh hạ cánh trên núi băng quá đỉnh!",
      "likes": 1240,
      "hours_ago": 2
    },
    { "key": "r1", "parent": "c1", "user": "u3", "media": "vung-troi-cuoi-cung", "body": "Đồng ý! Mình xem chuyến HAN – SGN cũng bị cuốn y vậy.", "likes": 40, "hours_ago": 1 }
  ]
```

(Đoạn trên rút gọn; file thật có 8 người, 6 bình luận gốc, 4 trả lời.)

### Bước 3: `backend/cmd/seed/main.go`

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

	if err := seedComments(ctx, q, data, now); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	log.Info("đã nạp dữ liệu mẫu",
		"categories", len(data.Categories), "channels", len(data.Channels), "media", len(data.Media),
		"news", len(data.News), "users", len(data.Users), "comments", len(data.Comments))
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
```

- **`uuid.NewSHA1(seedNamespace, "comment:c1")`** (uuid v5): cùng khoá luôn ra cùng id, nên
  `ON CONFLICT (id)` cập nhật đúng bình luận cũ. Bình luận không có cột nào khác duy nhất để làm khoá
  `ON CONFLICT` như `slug` của media.
- **Hai lượt: gốc trước, trả lời sau**: trả lời có khoá ngoại tới bình luận gốc, gốc phải có trước.
- **`reply_count` đếm từ dữ liệu thật**, không lấy số "128 trả lời" của mockup: số đếm phải khớp với số
  trả lời có trong database, nếu không "Xem 128 trả lời" mở ra chỉ có 1.
- **Mật khẩu ngẫu nhiên 32 byte, không lưu ở đâu**: `seed-u1@airlife.local` có trong database nhưng không
  ai đăng nhập được.

```bash
make seed
make seed   # chạy lại: vẫn 10 bình luận, không nhân đôi
```

## Kiểm tra

Cần một tài khoản **đã xác minh email**. Đăng ký và xác minh qua Mailpit như bài 4.11, rồi thử lần lượt.
Lưu thành file `thu5.sh` ở **ngoài** repo rồi chạy `bash thu5.sh`:

```bash
set -e
A=localhost:8080/api/v1; H='-H Content-Type:application/json'; O='-H Origin:http://localhost:3000'; M=localhost:8025/api/v1
curl -s -X DELETE $M/messages >/dev/null
E="thu5-$(date +%s)@example.com"
curl -s -o /dev/null -c j.txt $H $O -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Năm\"}" $A/auth/register
echo "--- bình luận khi chưa xác minh"
curl -s -b j.txt $H $O -d '{"body":"Xin chào"}' $A/media/vung-troi-cuoi-cung/comments; echo
sleep 2
ID=$(curl -s $M/messages | python3 -c "import sys,json;print(json.load(sys.stdin)['messages'][0]['ID'])")
TOKEN=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
curl -s -o /dev/null $H $O -d "{\"token\":\"$TOKEN\"}" $A/auth/verify-email
echo "--- theo dõi 2 lần"
curl -s -b j.txt $O -X POST $A/channels/bay-vui/follow; echo
curl -s -b j.txt $O -X POST $A/channels/bay-vui/follow; echo
curl -s -b j.txt $A/me/following; echo
curl -s -b j.txt $O -X DELETE $A/channels/bay-vui/follow; echo
echo "--- viết bình luận, trả lời"
C=$(curl -s -b j.txt $H $O -d '{"body":"<b>Phim hay</b>"}' $A/media/vung-troi-cuoi-cung/comments | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
echo
R=$(curl -s -b j.txt $H $O -d "{\"body\":\"Trả lời\",\"parent_id\":\"$C\"}" $A/media/vung-troi-cuoi-cung/comments | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
curl -s -o /dev/null -b j.txt $H $O -d "{\"body\":\"Trả lời của trả lời\",\"parent_id\":\"$R\"}" $A/media/vung-troi-cuoi-cung/comments
curl -s $A/comments/$C/replies | python3 -c "import sys,json;print([c['body'] for c in json.load(sys.stdin)['data']['items']])"
echo "--- parent ở media khác"
curl -s -b j.txt $H $O -d "{\"body\":\"x\",\"parent_id\":\"$C\"}" $A/media/chuyen-bay-ve-nha/comments; echo
echo "--- thích 2 lần"
curl -s -b j.txt $O -X POST $A/comments/$C/like; echo
curl -s -b j.txt $O -X POST $A/comments/$C/like; echo
echo "--- xoá bình luận mẫu của người khác"
S=$(curl -s "$A/media/vung-troi-cuoi-cung/comments?sort=top" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['items'][0]['id'])")
curl -s -b j.txt $O -X DELETE $A/comments/$S; echo
curl -s -o /dev/null -w "xoá của mình: %{http_code}\n" -b j.txt $O -X DELETE $A/comments/$C
echo "--- spam"
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code} " -b j.txt $H $O -d "{\"body\":\"spam $i\"}" $A/media/vung-troi-cuoi-cung/comments; done; echo
rm -f j.txt
```

Kết quả thật:

```text
--- bình luận khi chưa xác minh
{"error":{"code":"email_not_verified","message":"Bạn cần xác minh email trước khi bình luận","request_id":"c9f409d378fd/oNaApN44mH-000130"}}

--- theo dõi 2 lần
{"data":{"following":true,"followers_count":54201}}

{"data":{"following":true,"followers_count":54201}}

{"data":[{"slug":"bay-vui","name":"Bay Vui Travel","verified":true}]}

{"data":{"following":false,"followers_count":54200}}

--- viết bình luận, trả lời

['Trả lời', 'Trả lời của trả lời']
--- parent ở media khác
{"error":{"code":"comment_not_found","message":"Không tìm thấy bình luận","request_id":"c9f409d378fd/oNaApN44mH-000142"}}

--- thích 2 lần
{"data":{"like_count":1,"liked":true}}

{"data":{"like_count":1,"liked":true}}

--- xoá bình luận mẫu của người khác
{"error":{"code":"forbidden","message":"Bạn không có quyền xoá bình luận này","request_id":"c9f409d378fd/oNaApN44mH-000146"}}

xoá của mình: 204
--- spam
201 201 201 201 201 201 429 429 429 429 
```

Đọc kết quả:

- **Chưa xác minh**: `403 email_not_verified`.
- **Theo dõi hai lần**: số người theo dõi chỉ tăng 1 (54200 → 54201); bỏ theo dõi về lại 54200.
- **Trả lời của trả lời** nằm cùng danh sách trả lời của bình luận gốc (một cấp).
- **`<b>Phim hay</b>`** được lưu nguyên văn (JSON hiện thành `<b>`). Bình luận là chữ thường,
  không phải HTML: React tự escape khi hiện, nên không cần bluemonday như thân bài tin tức.
- **Gửi `parent_id` của video khác**: `404 comment_not_found`.
- **Thích hai lần**: vẫn `like_count: 1`.
- **Spam**: chỉ 6 lần `201` rồi `429`, vì 4 lần gửi trước đó (kể cả lần bị từ chối vì sai `parent_id`)
  đã tính vào giới hạn 10 lần / 5 phút. Giới hạn đếm **lần thử**, không chỉ lần thành công.

Trang chủ:

```bash
docker compose exec redis redis-cli -a airlife --no-auth-warning DEL cache:home
curl -s localhost:8080/api/v1/home | python3 -c "import sys,json;h=json.load(sys.stdin)['data']['hot_comments'];print([c['author']['display_name'] for c in h['top']]);print([c['reply_count'] for c in h['replied']])"
```

```text
['Minh Anh', 'Hoàng Long', 'Thu Trang', 'Quốc Bảo', 'Đức Huy']
[2, 1, 1, 0, 0]
```

Dọn dữ liệu thử (xoá người dùng thì bình luận, lượt thích, theo dõi của họ xoá theo nhờ `ON DELETE CASCADE`)
và khoá giới hạn tốc độ:

```bash
make psql
```

```sql
DELETE FROM users WHERE email LIKE 'thu5-%';
```

```bash
make lint
git add . && git commit -m "Kênh, theo dõi, bình luận (backend)"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Chuyển bình luận từ `content.json` của mockup báo `KeyError: 'p01'` | Mockup có bình luận gắn vào sản phẩm (`p01`…); bỏ qua các bình luận đó |
| Chạy seed lần hai thì có 20 bình luận | Id bình luận sinh ngẫu nhiên; phải sinh từ khoá (uuid v5) |
| `register` trả `429` khi thử nhiều lần | Giới hạn 10 lần đăng ký / giờ / IP (bài 4.04) đang chạy đúng. Khi dev: `docker compose exec redis redis-cli -a airlife --no-auth-warning --scan --pattern 'auth:register:*'` rồi `DEL` khoá đó |
| `comment_not_found` khi trả lời | Bình luận gốc đã bị xoá, hoặc thuộc media khác |
