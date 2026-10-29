# Bài 8.01: Schema đặt vé, tour và lịch khởi hành mẫu

> [← Phần 07](../07-ban-hang/11-gan-vao-trang-va-nghiem-thu.md) · [Mục lục](../README.md) · [Bài sau →](02-giu-cho.md)

## Mục tiêu

Migration `000008_booking`: hạng dịch vụ, ngày khởi hành, số chỗ, đơn giữ chỗ, hành khách. Truy vấn sqlc
và lịch khởi hành mẫu cho 9 sản phẩm vé, tour.

Hai quyết định đã chốt với khách:

| Câu hỏi | Chốt |
|---|---|
| Đơn giữ chỗ kết thúc thế nào khi chưa có thanh toán online | **Giữ 20 phút chờ thanh toán** (Phần 09). Quá hạn thì worker huỷ đơn, trả chỗ |
| Giữ chỗ bằng khoá Redis (như TASKS.md ghi lúc đầu) hay PostgreSQL | **PostgreSQL** |

Vì sao không dùng khoá Redis: chỗ đã giữ là dữ liệu quan trọng (khách đã điền hành khách, sắp trả tiền).
Đặt nó ở Redis thì có hai nơi giữ sự thật (Redis biết ai đang giữ, PostgreSQL biết đơn), phải đồng bộ khi
xác nhận đơn, và Redis khởi động lại là mất. Trong PostgreSQL, "lấy chỗ" là một câu `UPDATE` có điều kiện,
chạy cùng transaction với việc tạo đơn, giống hệt trừ kho ở Phần 07.

## Bạn sẽ học

- Mô hình số chỗ: `capacity` và `taken` theo từng (ngày, hạng), `CHECK taken <= capacity`.
- Chỉ mục một phần (partial index) cho việc nền chỉ quét vài dòng.
- CTE có `UPDATE ... RETURNING` để huỷ đơn và trả chỗ trong **một** câu lệnh.
- `UPDATE ... FROM` với nhiều dòng nguồn trùng đích: phải cộng dồn trước.

## Viết code

### Bước 1: Migration

```bash
make migrate-new name=booking
```

`backend/migrations/000008_booking.up.sql`:

```sql
-- Đặt vé bay, tour (Phần 08): hạng dịch vụ, lịch khởi hành, số chỗ, đơn giữ chỗ, hành khách.
--
-- Giữ chỗ nằm ngay trong PostgreSQL (không dùng khoá Redis): "lấy chỗ" là một câu UPDATE có điều
-- kiện trên departure_seats, chạy cùng transaction với việc tạo đơn. Một nguồn dữ liệu duy nhất;
-- Redis khởi động lại không làm mất chỗ đã giữ. Worker trả ghế của đơn quá hạn.

-- Hạng dịch vụ của một sản phẩm: Phổ thông / Thương gia (vé), Tiêu chuẩn / Cao cấp (tour)
CREATE TABLE product_fares (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    code         text NOT NULL,
    label        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    adult_price  bigint NOT NULL CHECK (adult_price > 0),
    -- Trẻ em 2–11 tuổi (tính theo ngày khởi hành). Chưa nhận em bé dưới 2 tuổi.
    child_price  bigint NOT NULL CHECK (child_price > 0 AND child_price <= adult_price),
    sort_order   smallint NOT NULL DEFAULT 0,
    UNIQUE (product_id, code)
);

-- Ngày khởi hành. Vé khứ hồi, tour có ngày về (return_date) cố định theo lịch của nhà cung cấp.
CREATE TABLE departures (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    depart_date  date NOT NULL,
    return_date  date CHECK (return_date >= depart_date),
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    UNIQUE (product_id, depart_date)
);

-- Số chỗ theo (ngày khởi hành, hạng). taken = chỗ của đơn đang giữ, chờ thanh toán, đã xác nhận.
-- CHECK taken <= capacity: kể cả code có lỗi, database cũng không cho bán quá số chỗ.
CREATE TABLE departure_seats (
    departure_id uuid NOT NULL REFERENCES departures (id) ON DELETE CASCADE,
    fare_id      uuid NOT NULL REFERENCES product_fares (id) ON DELETE CASCADE,
    capacity     integer NOT NULL CHECK (capacity >= 0),
    taken        integer NOT NULL DEFAULT 0 CHECK (taken >= 0 AND taken <= capacity),
    PRIMARY KEY (departure_id, fare_id)
);

CREATE TABLE bookings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text NOT NULL UNIQUE, -- BK-7KQ2M9XA
    user_id          uuid NOT NULL REFERENCES users (id),
    departure_id     uuid NOT NULL REFERENCES departures (id),
    fare_id          uuid NOT NULL REFERENCES product_fares (id),
    -- held: vừa giữ chỗ, chưa có hành khách → awaiting_payment: đã có hành khách, chờ thanh toán
    -- (Phần 09) → confirmed. Hoặc cancelled (khách huỷ), expired (quá hạn giữ chỗ).
    status           text NOT NULL DEFAULT 'held'
        CHECK (status IN ('held', 'awaiting_payment', 'confirmed', 'cancelled', 'expired')),
    expires_at       timestamptz NOT NULL,
    adults           smallint NOT NULL CHECK (adults >= 1),
    children         smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
    -- Chép lại lúc đặt (như order_items, Phần 07): đổi giá, đổi tên sau này không ảnh hưởng đơn cũ
    product_slug     text NOT NULL,
    product_name     text NOT NULL,
    fare_label       text NOT NULL,
    depart_date      date NOT NULL,
    return_date      date,
    adult_price      bigint NOT NULL,
    child_price      bigint NOT NULL,
    total            bigint NOT NULL CHECK (total = adult_price * adults + child_price * children),
    contact_name     text,
    contact_phone    text,
    contact_email    text,
    idempotency_key  text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key),
    CHECK (adults + children <= 9),
    -- Đã qua bước điền thông tin thì phải có người liên hệ
    CHECK (status NOT IN ('awaiting_payment', 'confirmed') OR contact_name IS NOT NULL)
);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC, id DESC);
-- Worker tìm đơn quá hạn: chỉ mục chỉ chứa đơn còn đang giữ chỗ (rất ít dòng)
CREATE INDEX bookings_hold_expiry_idx ON bookings (expires_at)
    WHERE status IN ('held', 'awaiting_payment');

CREATE TABLE booking_passengers (
    booking_id  uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    position    smallint NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('adult', 'child')),
    -- Họ tên viết hoa không dấu như trên giấy tờ (NGUYEN VAN A): hãng bay, khách sạn nước ngoài
    -- không nhận chữ có dấu
    full_name   text NOT NULL,
    birth_date  date NOT NULL,
    PRIMARY KEY (booking_id, position)
);
```

`backend/migrations/000008_booking.down.sql`:

```sql
DROP TABLE IF EXISTS booking_passengers;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS departure_seats;
DROP TABLE IF EXISTS departures;
DROP TABLE IF EXISTS product_fares;
```

- **`taken` gồm chỗ của đơn đang giữ, chờ thanh toán và đã xác nhận**: chỉ cần một con số, không phải
  cộng các đơn mỗi lần xem lịch.
- **Giá, tên, ngày chép vào `bookings`** như dòng đơn hàng ở Phần 07.
- **`bookings_hold_expiry_idx ... WHERE status IN ('held', 'awaiting_payment')`**: bảng đơn lớn dần mãi,
  nhưng đơn đang giữ chỗ lúc nào cũng chỉ vài chục. Worker hỏi "đơn nào quá hạn" 30 giây một lần chỉ quét
  chỉ mục nhỏ này.

```bash
make migrate && make migrate-down && make migrate
```

### Bước 2: Truy vấn, `backend/internal/db/queries/bookings.sql`

```sql
-- Đặt vé, tour (Phần 08).

-- Hạng dịch vụ của một sản phẩm
-- name: ListProductFares :many
SELECT f.id, f.code, f.label, f.description, f.adult_price, f.child_price
FROM product_fares f
JOIN products p ON p.id = f.product_id
WHERE p.slug = $1 AND p.status = 'published' AND p.kind = 'booking'
ORDER BY f.sort_order;

-- Lịch khởi hành còn mở, từ ngày from_date (ngày mai: chốt đặt trước một ngày) trong 120 ngày tới,
-- mỗi dòng là một (ngày, hạng) kèm số chỗ còn lại
-- name: ListDepartureSeats :many
SELECT d.id AS departure_id, d.depart_date, d.return_date, s.fare_id, s.capacity - s.taken AS seats_left
FROM departures d
JOIN products p ON p.id = d.product_id
JOIN departure_seats s ON s.departure_id = d.id
JOIN product_fares f ON f.id = s.fare_id
WHERE p.slug = sqlc.arg('slug') AND d.status = 'open'
  AND d.depart_date >= sqlc.arg('from_date')::date
  AND d.depart_date < sqlc.arg('from_date')::date + 120
ORDER BY d.depart_date, f.sort_order;

-- Thông tin để tạo đơn: ngày khởi hành + hạng phải cùng một sản phẩm đang bán
-- name: GetDepartureFare :one
SELECT d.id AS departure_id, d.depart_date, d.return_date, d.status AS departure_status,
       f.id AS fare_id, f.label AS fare_label, f.adult_price, f.child_price,
       p.slug AS product_slug, p.name AS product_name, p.tag
FROM departures d
JOIN products p ON p.id = d.product_id
JOIN product_fares f ON f.product_id = p.id
WHERE d.id = sqlc.arg('departure_id') AND f.id = sqlc.arg('fare_id')
  AND p.status = 'published' AND p.kind = 'booking';

-- Lấy chỗ CÓ ĐIỀU KIỆN (như trừ kho ở Phần 07): còn đủ chỗ thì lấy, không thì 0 dòng.
-- name: TakeSeats :execrows
UPDATE departure_seats SET taken = taken + sqlc.arg('seats')
WHERE departure_id = sqlc.arg('departure_id') AND fare_id = sqlc.arg('fare_id')
  AND taken + sqlc.arg('seats') <= capacity;

-- name: SeatsLeft :one
SELECT capacity - taken FROM departure_seats WHERE departure_id = $1 AND fare_id = $2;

-- Số đơn đang giữ chỗ của một người (chặn "giữ chỗ hàng loạt" rồi bỏ đó)
-- name: CountActiveHolds :one
SELECT count(*) FROM bookings
WHERE user_id = $1 AND status IN ('held', 'awaiting_payment') AND expires_at > now();

-- name: GetBookingCodeByIdempotencyKey :one
SELECT code FROM bookings WHERE user_id = $1 AND idempotency_key = $2;

-- name: CreateBooking :one
INSERT INTO bookings (code, user_id, departure_id, fare_id, expires_at, adults, children,
                      product_slug, product_name, fare_label, depart_date, return_date,
                      adult_price, child_price, total, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING id;

-- name: GetBooking :one
SELECT b.id, b.code, b.status, b.expires_at, b.adults, b.children, b.product_slug, b.product_name,
       b.fare_label, b.depart_date, b.return_date, b.adult_price, b.child_price, b.total,
       b.contact_name, b.contact_phone, b.contact_email, b.created_at,
       p.tag AS product_tag, p.image_url AS product_image
FROM bookings b
JOIN departures d ON d.id = b.departure_id
JOIN products p ON p.id = d.product_id
WHERE b.user_id = $1 AND b.code = $2;

-- name: ListBookingPassengers :many
SELECT kind, full_name, birth_date FROM booking_passengers WHERE booking_id = $1 ORDER BY position;

-- name: ListBookings :many
SELECT b.code, b.status, b.expires_at, b.product_name, b.fare_label, b.depart_date, b.adults,
       b.children, b.total, b.created_at, b.id, p.image_url AS product_image
FROM bookings b
JOIN departures d ON d.id = b.departure_id
JOIN products p ON p.id = d.product_id
WHERE b.user_id = sqlc.arg('user_id')
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (b.created_at, b.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY b.created_at DESC, b.id DESC
LIMIT sqlc.arg('limit');

-- Khoá đơn để điền hành khách: chỉ khi còn đang giữ chỗ và chưa hết hạn
-- name: LockBookingForUpdate :one
SELECT id, adults, children, depart_date FROM bookings
WHERE user_id = $1 AND code = $2 AND status IN ('held', 'awaiting_payment') AND expires_at > now()
FOR UPDATE;

-- name: DeleteBookingPassengers :exec
DELETE FROM booking_passengers WHERE booking_id = $1;

-- name: CreateBookingPassenger :exec
INSERT INTO booking_passengers (booking_id, position, kind, full_name, birth_date)
VALUES ($1, $2, $3, $4, $5);

-- name: SetBookingContact :exec
UPDATE bookings
SET contact_name = $2, contact_phone = $3, contact_email = $4, status = 'awaiting_payment',
    updated_at = now()
WHERE id = $1;

-- Huỷ và trả ghế trong MỘT câu lệnh (CTE có UPDATE): chỉ đơn còn đang giữ chỗ mới huỷ được.
-- Huỷ cùng lúc với worker hết hạn: chỉ một trong hai đổi được trạng thái (điều kiện status), nên
-- ghế chỉ được trả một lần.
-- name: CancelBooking :execrows
WITH c AS (
    UPDATE bookings SET status = 'cancelled', updated_at = now()
    WHERE user_id = $1 AND code = $2 AND status IN ('held', 'awaiting_payment')
    RETURNING departure_id, fare_id, adults + children AS seats
)
UPDATE departure_seats s SET taken = s.taken - c.seats
FROM c
WHERE s.departure_id = c.departure_id AND s.fare_id = c.fare_id;

-- Worker: hết hạn mọi đơn quá giờ và trả ghế, một câu lệnh. Nhiều đơn cùng (ngày, hạng) thì cộng
-- dồn trước (GROUP BY): UPDATE ... FROM chỉ áp dụng MỘT dòng nguồn cho mỗi dòng đích.
-- name: ExpireBookings :execrows
WITH e AS (
    UPDATE bookings SET status = 'expired', updated_at = now()
    WHERE status IN ('held', 'awaiting_payment') AND expires_at <= now()
    RETURNING departure_id, fare_id, adults + children AS seats
), sums AS (
    SELECT departure_id, fare_id, sum(seats)::integer AS seats FROM e GROUP BY departure_id, fare_id
)
UPDATE departure_seats s SET taken = s.taken - sums.seats
FROM sums
WHERE s.departure_id = sums.departure_id AND s.fare_id = sums.fare_id;
```

- **`TakeSeats`**: `taken + seats <= capacity` trong `WHERE`. Hai người cùng giữ chỗ cuối: người sau thấy
  `taken` đã tăng, không khớp, 0 dòng.
- **`CancelBooking`**: CTE `c` đổi trạng thái và trả về số ghế; câu `UPDATE` ngoài trả ghế theo kết quả đó.
  Đơn không còn đang giữ thì CTE không ra dòng nào, không trả ghế. Khách bấm huỷ đúng lúc worker hết hạn
  đơn: một bên đổi được trạng thái, bên kia thấy trạng thái đã khác, ghế chỉ trả một lần.
- **`ExpireBookings` có bước `sums ... GROUP BY`**: hai đơn cùng (ngày, hạng) hết hạn cùng lúc. Nếu
  `UPDATE departure_seats ... FROM e` thẳng, PostgreSQL chỉ áp **một** dòng nguồn cho mỗi dòng đích, ghế
  của đơn thứ hai không được trả. Cộng dồn trước rồi mới trừ.
- **`ListDepartureSeats ... ORDER BY d.depart_date, f.sort_order`**: thứ tự hạng phải cố định (xem "Hay
  gặp lỗi").

### Bước 3: Lịch khởi hành mẫu

Thêm vào cuối `backend/internal/db/queries/seed.sql`:

```sql
-- name: UpsertProductFare :one
INSERT INTO product_fares (product_id, code, label, description, adult_price, child_price, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (product_id, code) DO UPDATE
SET label = EXCLUDED.label, description = EXCLUDED.description, adult_price = EXCLUDED.adult_price,
    child_price = EXCLUDED.child_price, sort_order = EXCLUDED.sort_order
RETURNING id;

-- Lịch khởi hành mẫu: đã có thì giữ nguyên (không đụng số chỗ đã giữ khi thử)
-- name: UpsertDeparture :one
INSERT INTO departures (product_id, depart_date, return_date)
VALUES ($1, $2, $3)
ON CONFLICT (product_id, depart_date) DO UPDATE SET return_date = EXCLUDED.return_date
RETURNING id;

-- name: UpsertDepartureSeats :exec
INSERT INTO departure_seats (departure_id, fare_id, capacity)
VALUES ($1, $2, $3)
ON CONFLICT (departure_id, fare_id) DO NOTHING;
```

```bash
make sqlc
```

Trong `backend/cmd/seed/data.json`, mỗi sản phẩm vé, tour có thêm khối `booking` (hạng, giá trẻ em, số chỗ
là dữ liệu mẫu tự đặt; giá người lớn hạng đầu bằng giá của mockup):

```json
      "booking": {
        "fares": [
          { "code": "tieu-chuan", "label": "Tiêu chuẩn", "description": "Khách sạn 3–4 sao, xe đoàn, hướng dẫn viên",
            "adult_price": 2490000, "child_price": 1790000, "capacity": 20 },
          { "code": "cao-cap", "label": "Cao cấp", "description": "Khách sạn 5 sao, xe riêng, hướng dẫn viên riêng",
            "adult_price": 3490000, "child_price": 2490000, "capacity": 8 }
        ],
        "first_in_days": 2,
        "every_days": 7,
        "trip_days": 2,
        "count": 12
      }
```

`backend/cmd/seed/main.go` thêm kiểu `seedFare`, trường `Booking` và hàm `seedDepartures`. Bản đầy đủ:

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
		Booking *struct {
			Fares       []seedFare `json:"fares"`
			FirstInDays int        `json:"first_in_days"` // chuyến đầu sau mấy ngày (tính từ hôm chạy seed)
			EveryDays   int        `json:"every_days"`    // mấy ngày một chuyến
			TripDays    int        `json:"trip_days"`     // số ngày chuyến đi; 0 = vé một chiều (không có ngày về)
			Count       int        `json:"count"`         // số chuyến
		} `json:"booking"`
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

// seedFare: một hạng dịch vụ của vé, tour, kèm số chỗ mỗi chuyến (Phần 08)
type seedFare struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	AdultPrice  int64  `json:"adult_price"`
	ChildPrice  int64  `json:"child_price"`
	Capacity    int32  `json:"capacity"`
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
		if p.Booking != nil {
			if err := seedDepartures(ctx, q, id, p.Booking.Fares, p.Booking.FirstInDays,
				p.Booking.EveryDays, p.Booking.TripDays, p.Booking.Count, now); err != nil {
				return fmt.Errorf("lịch khởi hành %s: %w", p.Slug, err)
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

// seedDepartures nạp hạng dịch vụ và lịch khởi hành của vé, tour (Phần 08). Ngày khởi hành tính
// từ hôm chạy seed; chạy lại vào hôm khác thì thêm ngày mới, ngày cũ (và số chỗ đã giữ) giữ nguyên.
func seedDepartures(
	ctx context.Context, q *db.Queries, productID uuid.UUID, fares []seedFare,
	firstInDays, everyDays, tripDays, count int, now time.Time,
) error {
	fareIDs := make([]uuid.UUID, len(fares))
	for i, f := range fares {
		id, err := q.UpsertProductFare(ctx, db.UpsertProductFareParams{
			ProductID: productID, Code: f.Code, Label: f.Label, Description: f.Description,
			AdultPrice: f.AdultPrice, ChildPrice: f.ChildPrice, SortOrder: int16(i), //nolint:gosec // vài hạng
		})
		if err != nil {
			return err
		}
		fareIDs[i] = id
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	for n := range count {
		depart := today.AddDate(0, 0, firstInDays+n*everyDays)
		var ret *time.Time
		if tripDays > 0 {
			r := depart.AddDate(0, 0, tripDays)
			ret = &r
		}
		depID, err := q.UpsertDeparture(ctx, db.UpsertDepartureParams{
			ProductID: productID, DepartDate: depart, ReturnDate: ret,
		})
		if err != nil {
			return err
		}
		for i, f := range fares {
			if err := q.UpsertDepartureSeats(ctx, db.UpsertDepartureSeatsParams{
				DepartureID: depID, FareID: fareIDs[i], Capacity: f.Capacity,
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

**Ngày khởi hành tính từ hôm chạy seed**: dữ liệu mẫu luôn có chuyến trong tương lai. Chạy seed vào hôm
khác thì thêm ngày mới, ngày cũ giữ nguyên (`DO NOTHING` cho số chỗ).

```bash
make seed
```

## Kiểm tra

```sql
-- make psql
SELECT count(*) FROM departures;                       -- 158
SELECT count(*), sum(capacity) FROM departure_seats;   -- 316 | 4592
UPDATE departure_seats SET taken = capacity + 1;
-- ERROR: ... violates check constraint "departure_seats_check"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Hai đơn cùng chuyến hết hạn, chỉ một đơn được trả ghế | `UPDATE ... FROM` thẳng từ danh sách đơn; phải `GROUP BY` cộng dồn trước |
| Danh sách số chỗ lúc hạng Phổ thông đứng trước, lúc Thương gia | Thiếu `ORDER BY f.sort_order`. Thứ tự dòng không có `ORDER BY` là không xác định |
| Struct ẩn danh của hạng dịch vụ lặp lại hai lần trong `main.go` | Bản đầu khai báo `[]struct{...}` ngay trong `seedData` rồi chép lại ở tham số hàm. Tách thành kiểu có tên `seedFare` |
