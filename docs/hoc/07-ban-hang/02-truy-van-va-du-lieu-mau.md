# Bài 7.02: Truy vấn sản phẩm, giỏ, đơn hàng và dữ liệu mẫu

> [← Bài trước](01-schema-ban-hang.md) · [Mục lục](../README.md) · [Bài sau →](03-module-san-pham.md)

## Mục tiêu

- Truy vấn sqlc cho sản phẩm, yêu thích, giỏ hàng, đơn hàng.
- Seed 16 sản phẩm của mockup: 7 hàng hoá có biến thể, 9 vé/tour; liên kết sản phẩm với video.

## Bạn sẽ học

- Nhiều truy vấn chọn cùng bộ cột → đổi kiểu `...Row` của sqlc bằng chuyển kiểu struct của Go.
- Trừ tồn kho có điều kiện trong **một** câu `UPDATE`.
- Gộp giỏ bằng `GREATEST` để gộp hai lần vẫn đúng.
- Seed không "nạp lại hàng" khi chạy lại.

## Viết code

### Bước 1: `backend/internal/db/queries/products.sql`

```sql
-- Sản phẩm, yêu thích (Phần 07).
--
-- Các truy vấn danh sách chọn CÙNG một bộ cột theo cùng thứ tự, nên các kiểu ...Row sqlc sinh ra
-- có trường giống hệt nhau: Go cho đổi kiểu trực tiếp (db.ListProductsNewRow(row)), và chỉ cần
-- một hàm chuyển sang thẻ sản phẩm (product.toCard). Không dùng sqlc.embed(p) vì sẽ kéo cả
-- body_html (dài) về cho mỗi thẻ.

-- name: ListProductsNew :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR p.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tag = sqlc.narg('tag'))
  AND (sqlc.narg('channel')::text IS NULL OR c.slug = sqlc.narg('channel'))
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (p.published_at, p.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY p.published_at DESC, p.id DESC
LIMIT sqlc.arg('limit');

-- Bán chạy: con trỏ theo (sold_count, id)
-- name: ListProductsBestseller :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published'
  AND (sqlc.narg('category')::text IS NULL OR p.category_slug = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR p.tag = sqlc.narg('tag'))
  AND (sqlc.narg('channel')::text IS NULL OR c.slug = sqlc.narg('channel'))
  AND (sqlc.narg('cursor_sold')::integer IS NULL
       OR (p.sold_count, p.id) < (sqlc.narg('cursor_sold')::integer, sqlc.narg('cursor_id')::uuid))
ORDER BY p.sold_count DESC, p.id DESC
LIMIT sqlc.arg('limit');

-- Cùng chip lọc trước, rồi cùng chuyên mục ("Có thể bạn cũng thích")
-- name: ListRelatedProducts :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.status = 'published' AND p.category_slug = sqlc.arg('category') AND p.id <> sqlc.arg('exclude_id')
ORDER BY (p.tag = sqlc.arg('tag')) DESC, p.sold_count DESC
LIMIT sqlc.arg('limit');

-- Sản phẩm trong một video (trang xem)
-- name: ListMediaProducts :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified
FROM media_products mp
JOIN media m ON m.id = mp.media_id
JOIN products p ON p.id = mp.product_id
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE m.slug = $1 AND p.status = 'published'
ORDER BY mp.sort_order;

-- name: GetProductBySlug :one
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.body_html, p.image_url, p.gallery, p.price, p.old_price, p.delivery_methods,
       p.rating, p.rating_count, p.sold_count, p.published_at,
       cat.name AS category_name,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified,
       c.type AS channel_type, c.followers_count AS channel_followers
FROM products p
JOIN channels c ON c.id = p.channel_id
JOIN categories cat ON cat.slug = p.category_slug
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE p.slug = $1 AND p.status = 'published';

-- name: ListProductVariants :many
SELECT id, label, price, old_price, stock
FROM product_variants
WHERE product_id = $1 AND active
ORDER BY sort_order, label;

-- Video có sản phẩm này ("Xuất hiện trong")
-- name: ListProductMedia :many
SELECT sqlc.embed(m), sqlc.embed(c)
FROM media_products mp
JOIN media m ON m.id = mp.media_id
JOIN channels c ON c.id = m.channel_id
WHERE mp.product_id = $1 AND m.status = 'published'
ORDER BY m.published_at DESC
LIMIT 6;

-- Yêu thích --------------------------------------------------------------------------------

-- name: AddFavorite :execrows
INSERT INTO favorites (user_id, product_id)
SELECT sqlc.arg('user_id'), p.id FROM products p
WHERE p.slug = sqlc.arg('slug') AND p.status = 'published'
ON CONFLICT DO NOTHING;

-- name: RemoveFavorite :exec
DELETE FROM favorites f
USING products p
WHERE f.product_id = p.id AND f.user_id = $1 AND p.slug = $2;

-- name: IsFavorite :one
SELECT EXISTS (
    SELECT 1 FROM favorites f JOIN products p ON p.id = f.product_id
    WHERE f.user_id = $1 AND p.slug = $2
);

-- name: GetProductIDBySlug :one
SELECT id FROM products WHERE slug = $1 AND status = 'published';

-- name: ListFavorites :many
SELECT p.id, p.slug, p.kind, p.category_slug, p.tag, cf.name AS tag_name, p.name, p.description,
       p.image_url, p.price, p.old_price, p.rating, p.rating_count, p.sold_count, p.published_at,
       c.slug AS channel_slug, c.name AS channel_name, c.verified AS channel_verified,
       f.created_at AS favorited_at
FROM favorites f
JOIN products p ON p.id = f.product_id
JOIN channels c ON c.id = p.channel_id
JOIN category_filters cf ON cf.category_slug = p.category_slug AND cf.slug = p.tag
WHERE f.user_id = sqlc.arg('user_id') AND p.status = 'published'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (f.created_at, f.product_id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY f.created_at DESC, f.product_id DESC
LIMIT sqlc.arg('limit');
```

**Chuyển kiểu struct**: `ListProductsNew`, `ListProductsBestseller`, `ListRelatedProducts`,
`ListMediaProducts` chọn **cùng cột, cùng thứ tự, cùng tên**, nên các struct sqlc sinh ra giống hệt nhau.
Go cho đổi thẳng `db.ListProductsNewRow(row)`. Chỉ cần lệch một tên trường là không đổi được (bài 7.05
gặp đúng trường hợp `ImageUrl` với `ImageURL`).

### Bước 2: `backend/internal/db/queries/cart.sql`

```sql
-- Giỏ hàng (Phần 07).

-- Dòng giỏ của người đã đăng nhập, kèm thông tin để hiện và kiểm tra (còn bán không, còn hàng
-- không, cách nhận hàng). Sản phẩm bị ẩn hay biến thể ngừng bán VẪN trả về (available = false)
-- để khách thấy và bỏ khỏi giỏ, thay vì món hàng tự biến mất không rõ lý do.
-- name: ListCartLines :many
SELECT v.id AS variant_id, v.label, v.price, v.old_price, v.stock,
       (v.active AND p.status = 'published' AND p.kind = 'goods')::boolean AS available,
       p.slug, p.name, p.image_url, p.delivery_methods,
       c.name AS channel_name, ci.quantity
FROM cart_items ci
JOIN product_variants v ON v.id = ci.variant_id
JOIN products p ON p.id = v.product_id
JOIN channels c ON c.id = p.channel_id
WHERE ci.user_id = $1
ORDER BY ci.updated_at DESC, v.id;

-- Giỏ của khách chưa đăng nhập nằm trong trình duyệt (chỉ có id biến thể và số lượng); API trả
-- thông tin hiện tại của các biến thể đó. Giá luôn lấy từ server, không tin giá client gửi.
-- name: GetVariantsForCart :many
SELECT v.id AS variant_id, v.label, v.price, v.old_price, v.stock,
       (v.active AND p.status = 'published' AND p.kind = 'goods')::boolean AS available,
       p.slug, p.name, p.image_url, p.delivery_methods,
       c.name AS channel_name
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN channels c ON c.id = p.channel_id
WHERE v.id = ANY(sqlc.arg('ids')::uuid[]);

-- Đặt số lượng một dòng giỏ. Chỉ thêm được biến thể đang bán của hàng hoá (vé, tour đi đường
-- đặt chỗ ở Phần 08). 0 dòng = biến thể không tồn tại / không bán.
-- name: SetCartItem :execrows
INSERT INTO cart_items (user_id, variant_id, quantity)
SELECT sqlc.arg('user_id'), v.id, sqlc.arg('quantity')
FROM product_variants v JOIN products p ON p.id = v.product_id
WHERE v.id = sqlc.arg('variant_id') AND v.active AND p.status = 'published' AND p.kind = 'goods'
ON CONFLICT (user_id, variant_id) DO UPDATE
SET quantity = EXCLUDED.quantity, updated_at = now();

-- Gộp giỏ của khách vào giỏ trên server khi đăng nhập: lấy số LỚN HƠN, không cộng dồn. Gộp hai
-- lần (bấm đăng nhập ở hai tab, mạng gửi lại) vẫn ra cùng kết quả; cộng dồn thì số lượng nhân đôi.
-- name: MergeCartItem :exec
INSERT INTO cart_items (user_id, variant_id, quantity)
SELECT sqlc.arg('user_id'), v.id, sqlc.arg('quantity')
FROM product_variants v JOIN products p ON p.id = v.product_id
WHERE v.id = sqlc.arg('variant_id') AND v.active AND p.status = 'published' AND p.kind = 'goods'
ON CONFLICT (user_id, variant_id) DO UPDATE
SET quantity = GREATEST(cart_items.quantity, EXCLUDED.quantity), updated_at = now();

-- name: DeleteCartItem :exec
DELETE FROM cart_items WHERE user_id = $1 AND variant_id = $2;

-- name: ClearCart :exec
DELETE FROM cart_items WHERE user_id = $1;

-- name: CountCartLines :one
SELECT count(*) FROM cart_items WHERE user_id = $1;
```

- **`available`** không lọc mất dòng: sản phẩm bị ẩn vẫn hiện trong giỏ, kèm lý do, để khách tự bỏ đi.
- **`MergeCartItem` dùng `GREATEST`**: khách có 2 hộp trong giỏ trình duyệt, đăng nhập ở hai tab cùng lúc
  thì gộp chạy hai lần. Cộng dồn ra 4 hộp; lấy số lớn hơn vẫn là 2.

### Bước 3: `backend/internal/db/queries/orders.sql`

```sql
-- Đơn hàng (Phần 07).

-- name: GetOrderCodeByIdempotencyKey :one
SELECT code FROM orders WHERE user_id = $1 AND idempotency_key = $2;

-- Trừ tồn kho CÓ ĐIỀU KIỆN, trong một câu lệnh: "còn đủ thì trừ". Hai người cùng mua chiếc cuối
-- cùng: câu thứ hai chạy sau câu thứ nhất (PostgreSQL khoá dòng khi UPDATE), thấy stock = 0,
-- không khớp WHERE, trả 0 dòng → báo hết hàng. Không bao giờ bán quá số đang có.
-- name: DecrementStock :execrows
UPDATE product_variants SET stock = stock - sqlc.arg('quantity')
WHERE id = sqlc.arg('id') AND active AND stock >= sqlc.arg('quantity');

-- name: AddProductSold :exec
UPDATE products SET sold_count = GREATEST(sold_count + sqlc.arg('delta')::integer, 0)
WHERE id = (SELECT product_id FROM product_variants WHERE product_variants.id = sqlc.arg('variant_id'));

-- name: CreateOrder :one
INSERT INTO orders (code, user_id, delivery_method, recipient_name, phone, flight_code,
                    flight_date, address, note, subtotal, shipping_fee, total, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id, created_at;

-- name: CreateOrderItem :exec
INSERT INTO order_items (order_id, variant_id, product_slug, product_name, variant_label,
                         image_url, unit_price, quantity, line_total, position)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- Danh sách đơn: kèm ảnh, tên của dòng đầu và số dòng ("Hộp quà Huế và 2 sản phẩm khác")
-- name: ListOrders :many
SELECT o.code, o.status, o.delivery_method, o.total, o.created_at, o.id,
       f.product_name AS first_name, f.image_url AS first_image,
       (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o
JOIN order_items f ON f.order_id = o.id AND f.position = 0
WHERE o.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (o.created_at, o.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY o.created_at DESC, o.id DESC
LIMIT sqlc.arg('limit');

-- name: GetOrder :one
SELECT id, code, status, payment_method, delivery_method, recipient_name, phone, flight_code,
       flight_date, address, note, subtotal, shipping_fee, total, created_at, cancelled_at
FROM orders WHERE user_id = $1 AND code = $2;

-- name: ListOrderItems :many
SELECT product_slug, product_name, variant_label, image_url, unit_price, quantity, line_total
FROM order_items WHERE order_id = $1 ORDER BY position;

-- Huỷ: chỉ khi còn "chờ xác nhận". Điều kiện status nằm trong WHERE: hai lần bấm huỷ cùng lúc thì
-- chỉ một lần đổi được trạng thái (và chỉ một lần trả hàng về kho).
-- name: CancelOrder :one
UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now()
WHERE user_id = $1 AND code = $2 AND status = 'pending'
RETURNING id;

-- Trả hàng của đơn bị huỷ về kho
-- name: RestockOrder :exec
UPDATE product_variants v SET stock = v.stock + oi.quantity
FROM order_items oi
WHERE oi.order_id = $1 AND oi.variant_id = v.id;

-- name: ListOrderVariantQuantities :many
SELECT variant_id, quantity FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL;
```

**`DecrementStock`**: không làm "đọc tồn kho, thấy đủ, rồi trừ" bằng hai câu. Giữa hai câu, người khác có
thể mua mất. Một câu `UPDATE ... WHERE stock >= quantity` vừa kiểm tra vừa trừ; PostgreSQL khoá dòng khi
`UPDATE`, nên hai người cùng mua món cuối thì người sau thấy `stock` đã giảm, không khớp `WHERE`, trả 0 dòng.

### Bước 4: Truy vấn seed

Thêm vào cuối `backend/internal/db/queries/seed.sql`:

```sql
-- name: UpsertProduct :one
INSERT INTO products (slug, kind, category_slug, tag, channel_id, name, description, body_html,
                      image_url, gallery, price, old_price, delivery_methods, rating, rating_count,
                      sold_count, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (slug) DO UPDATE
SET kind = EXCLUDED.kind, category_slug = EXCLUDED.category_slug, tag = EXCLUDED.tag,
    channel_id = EXCLUDED.channel_id, name = EXCLUDED.name, description = EXCLUDED.description,
    body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url, gallery = EXCLUDED.gallery,
    price = EXCLUDED.price, old_price = EXCLUDED.old_price,
    delivery_methods = EXCLUDED.delivery_methods, rating = EXCLUDED.rating,
    rating_count = EXCLUDED.rating_count, updated_at = now()
RETURNING id;

-- Tồn kho chỉ đặt lần đầu: chạy seed lại không "nạp lại hàng" cho biến thể đã bán bớt khi thử.
-- name: UpsertProductVariant :exec
INSERT INTO product_variants (product_id, sku, label, price, old_price, stock, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (sku) DO UPDATE
SET label = EXCLUDED.label, price = EXCLUDED.price, old_price = EXCLUDED.old_price,
    sort_order = EXCLUDED.sort_order;

-- name: UpsertMediaProduct :exec
INSERT INTO media_products (media_id, product_id, sort_order)
VALUES ($1, $2, $3)
ON CONFLICT (media_id, product_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;
```

`sold_count` và `stock` không nằm trong `DO UPDATE`: số đã bán và tồn kho thay đổi khi thử đặt hàng,
chạy seed lại không được ghi đè.

```bash
make sqlc
```

### Bước 5: Dữ liệu mẫu, `backend/cmd/seed/data.json`

Thêm mảng `products` (sau `news`). Mockup chỉ có một giá cho mỗi sản phẩm; biến thể, tồn kho, cách nhận
hàng là dữ liệu mẫu tự đặt. Tên sản phẩm của mockup có cả dung tích ("Nước hoa … 100ml"), nay "100ml" là
biến thể nên bỏ khỏi tên. Một sản phẩm:

```json
    {
      "slug": "hop-qua-dac-san-hue",
      "kind": "goods",
      "category": "kinh-doanh",
      "tag": "dac-san",
      "channel": "dac-san-3-mien",
      "name": "Hộp quà Đặc sản Huế",
      "description": "Mè xửng, tôm chua, mắm ruốc, trà cung đình… đóng hộp quà, giao tại sân bay đến.",
      "body_html": "<p>Mè xửng, tôm chua, mắm ruốc, trà cung đình… đóng hộp quà, giao tại sân bay đến.</p>",
      "price": 279000,
      "old_price": 320000,
      "rating": 4.8,
      "rating_count": 238,
      "sold": 2140,
      "published_days_ago": 0.0,
      "media": ["chuyen-bay-ve-nha", "an-gi-o-san-bay"],
      "delivery_methods": ["arrival", "home"],
      "variants": [
        { "label": "Hộp 6 món", "price": 389000, "old_price": 450000, "stock": 40 },
        { "label": "Hộp 4 món", "price": 279000, "old_price": 320000, "stock": 25 }
      ]
    }
```

Vé, tour: `"kind": "booking"`, `"variants": []`, `"delivery_methods": []`.

### Bước 6: `backend/cmd/seed/main.go`

Thêm `Products` vào `seedData` và hàm `seedProducts`, gọi trước `seedComments`. Bản đầy đủ:

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
```

- **SKU `<slug>-<thứ tự>`**: cố định, làm khoá `ON CONFLICT` cho biến thể.
- **`body_html` qua `sanitize.ArticleHTML`** như tin tức (bài 3.03): mọi đường ghi HTML đều lọc.

```bash
make seed   # ... products=16
```

## Kiểm tra

```sql
-- make psql
SELECT p.name, v.label, v.price, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id ORDER BY 1, 2;
UPDATE product_variants SET stock = -1 WHERE sku = 'ca-phe-buon-ma-thuot-rang-moc-1';
-- ERROR: new row for relation "product_variants" violates check constraint "product_variants_stock_check"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `cannot convert r (variable of struct type db.ListProductsBestsellerRow) to type db.ListProductsNewRow` | Hai truy vấn chọn cột khác nhau (thiếu, thừa, khác thứ tự, khác bí danh `AS`). Chép y nguyên danh sách cột |
| Seed lỗi `violates foreign key constraint "products_category_slug_tag_fkey"` | `tag` không phải chip lọc của chuyên mục đó (vd. `combo` thay vì `combo-bay-khach-san`) |
| Chạy seed lại thì tồn kho về như cũ | `stock` nằm trong `DO UPDATE SET` |
