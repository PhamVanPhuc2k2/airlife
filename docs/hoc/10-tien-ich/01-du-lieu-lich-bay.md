# Bài 10.01: Dữ liệu tiện ích: lịch bay hàng ngày, sân bay, gói Wi-Fi

> [← Phần 09](../09-thanh-toan/06-frontend-thanh-toan.md) · [Mục lục](../README.md) · [Bài sau →](02-trang-thai-va-vi-tri.md)

## Mục tiêu

Dựng schema cho mục Tiện ích (sân bay, chuyến bay, chuyến bay của người dùng, gói Wi-Fi) và nạp dữ liệu mẫu.

## Bạn sẽ học

- Vì sao lưu **lịch bay hàng ngày** thay vì từng chuyến bay theo từng ngày.
- Phân biệt dữ liệu **tham chiếu** (sân bay, gói Wi-Fi: cần cả ở production) với dữ liệu **mẫu** (lịch bay: chỉ dev).
- Lưu giờ theo giờ địa phương + múi giờ IANA thay vì UTC trần.
- Nhờ sqlc nhận cột `time` bằng cách ép kiểu trong SQL.

## Viết code

### Bước 1: Migration, `backend/migrations/000010_utilities.up.sql`

```sql
-- Tiện ích (Phần 10): sân bay, chuyến bay, chuyến bay của người dùng, gói Wi-Fi.
--
-- Chuyến bay lưu theo LỊCH BAY HÀNG NGÀY (giờ cất cánh theo giờ địa phương + thời gian bay), không
-- lưu từng ngày. Trạng thái (đang bay, đã hạ cánh…) và vị trí máy bay không nằm trong database:
-- code Go tính từ lịch + giờ hiện tại, nên bảng này không phải cập nhật mỗi phút. Khi nối nguồn
-- dữ liệu thật (AviationStack, FlightAware…) chỉ thay chỗ tính này, bảng và API giữ nguyên.

CREATE TABLE airports (
    code     char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'), -- mã IATA: SGN
    city     text NOT NULL,
    name     text NOT NULL,
    country  text NOT NULL,
    lat      double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon      double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
    -- Múi giờ IANA. Giờ bay luôn hiển thị theo giờ địa phương của sân bay đi/đến.
    timezone text NOT NULL
);

CREATE TABLE flights (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2} [0-9]{1,4}$'), -- VN 220
    airline          text NOT NULL,
    origin           char(3) NOT NULL REFERENCES airports (code),
    destination      char(3) NOT NULL REFERENCES airports (code),
    dep_local        time NOT NULL, -- giờ cất cánh theo giờ địa phương của sân bay đi, mỗi ngày
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 20 AND 1200),
    delay_minutes    integer NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 600),
    gate             text NOT NULL DEFAULT '',
    cancelled        boolean NOT NULL DEFAULT false,
    CHECK (origin <> destination)
);

-- Chuyến bay người dùng tự thêm để theo dõi (thẻ lên máy bay ở trang Bạn và Ra tàu bay).
-- Một chuyến (mã + ngày) chỉ thêm một lần cho mỗi người.
CREATE TABLE user_flights (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    flight_id   uuid NOT NULL REFERENCES flights (id) ON DELETE CASCADE,
    flight_date date NOT NULL, -- ngày cất cánh theo giờ địa phương của sân bay đi
    seat        text NOT NULL DEFAULT '' CHECK (seat ~ '^([0-9]{1,2}[A-K])?$'),
    cabin       text NOT NULL DEFAULT 'economy' CHECK (cabin IN ('economy', 'premium', 'business', 'first')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, flight_id, flight_date)
);

CREATE INDEX user_flights_user_idx ON user_flights (user_id, flight_date);

CREATE TABLE wifi_plans (
    id          smallserial PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL,
    price       bigint NOT NULL CHECK (price > 0), -- đồng
    popular     boolean NOT NULL DEFAULT false,
    sort_order  smallint NOT NULL DEFAULT 0
);

-- Dữ liệu tham chiếu (cần cả ở production): sân bay và gói Wi-Fi. Lịch bay mẫu nằm ở cmd/seed.
INSERT INTO airports (code, city, name, country, lat, lon, timezone) VALUES
    ('HAN', 'Hà Nội',   'Nội Bài',          'Việt Nam',  21.2212, 105.8072, 'Asia/Ho_Chi_Minh'),
    ('SGN', 'TP.HCM',    'Tân Sơn Nhất',     'Việt Nam',  10.8188, 106.6520, 'Asia/Ho_Chi_Minh'),
    ('DAD', 'Đà Nẵng',   'Đà Nẵng',          'Việt Nam',  16.0439, 108.1994, 'Asia/Ho_Chi_Minh'),
    ('PQC', 'Phú Quốc',  'Phú Quốc',         'Việt Nam',  10.1698, 103.9931, 'Asia/Ho_Chi_Minh'),
    ('BKK', 'Bangkok',   'Suvarnabhumi',     'Thái Lan',  13.6900, 100.7501, 'Asia/Bangkok'),
    ('SIN', 'Singapore', 'Changi',           'Singapore',  1.3644, 103.9915, 'Asia/Singapore'),
    ('ICN', 'Seoul',     'Incheon',          'Hàn Quốc',  37.4602, 126.4407, 'Asia/Seoul'),
    ('NRT', 'Tokyo',     'Narita',           'Nhật Bản',  35.7720, 140.3929, 'Asia/Tokyo');

INSERT INTO wifi_plans (name, description, price, popular, sort_order) VALUES
    ('Nhắn tin', 'Zalo, Messenger, WhatsApp suốt chặng bay', 49000, false, 1),
    ('Lướt web', 'Email, mạng xã hội, 1 thiết bị', 149000, true, 2),
    ('Cao cấp',  'Tốc độ cao, xem video, 2 thiết bị', 299000, false, 3);
```

Mấy quyết định đáng nhớ:

- **Không có cột "trạng thái" hay "vị trí" trong `flights`.** Trạng thái đổi mỗi phút; ghi vào database liên tục là
  tốn và dễ sai. Ta lưu **lịch** (giờ cất cánh trong ngày, thời gian bay, phút trễ) và để code Go **tính** trạng
  thái từ giờ hiện tại (bài 10.02). Sau này nối API chuyến bay thật chỉ thay chỗ tính này.
- **`dep_local time` + `airports.timezone`**: giờ cất cánh "08:00" luôn là giờ địa phương của sân bay đi. Đổi sang
  UTC rồi lưu sẽ sai khi nước đó đổi giờ mùa hè; lưu giờ địa phương và múi giờ IANA (`Asia/Tokyo`) thì thư viện
  tự xử lý.
- **`UNIQUE (user_id, flight_id, flight_date)`** trên `user_flights`: thêm cùng một chuyến hai lần là không thể,
  kể cả khi hai tab cùng bấm. Câu lệnh thêm dùng `ON CONFLICT DO NOTHING` rồi đọc số dòng đổi.
- Sân bay và gói Wi-Fi `INSERT` thẳng trong migration vì production cũng cần chúng. Lịch bay mẫu để ở `cmd/seed`
  (chỉ chạy ở dev).

### Bước 2: Câu truy vấn, `backend/internal/db/queries/flights.sql`

```sql
-- Tiện ích: sân bay, chuyến bay, chuyến bay của người dùng, gói Wi-Fi (Phần 10).

-- name: ListAirports :many
SELECT code, city, name, country, lat, lon, timezone FROM airports ORDER BY code;

-- name: ListFlights :many
SELECT code, airline, origin, destination, dep_local, duration_minutes, delay_minutes, gate, cancelled
FROM flights;

-- name: GetFlightByCode :one
SELECT id, code, airline, origin, destination, dep_local, duration_minutes, delay_minutes, gate, cancelled
FROM flights WHERE code = $1;

-- name: ListWifiPlans :many
SELECT id, name, description, price, popular FROM wifi_plans ORDER BY sort_order, id;

-- Chuyến bay của người dùng từ ngày from_date (ngày hôm qua tính theo giờ VN để vẫn thấy chuyến đang bay)
-- name: ListUserFlights :many
SELECT uf.id, uf.flight_date, uf.seat, uf.cabin, f.code
FROM user_flights uf
JOIN flights f ON f.id = uf.flight_id
WHERE uf.user_id = sqlc.arg('user_id') AND uf.flight_date >= sqlc.arg('from_date')::date
ORDER BY uf.flight_date, f.dep_local;

-- name: CountUserFlights :one
SELECT count(*) FROM user_flights
WHERE user_id = sqlc.arg('user_id') AND flight_date >= sqlc.arg('from_date')::date;

-- Thêm chuyến bay. Trùng (người này, chuyến này, ngày này) thì 0 dòng, không báo lỗi.
-- name: AddUserFlight :execrows
INSERT INTO user_flights (user_id, flight_id, flight_date, seat, cabin)
VALUES (sqlc.arg('user_id'), sqlc.arg('flight_id'), sqlc.arg('flight_date'), sqlc.arg('seat'), sqlc.arg('cabin'))
ON CONFLICT (user_id, flight_id, flight_date) DO NOTHING;

-- Xoá theo id VÀ user_id: không xoá nhầm chuyến bay của người khác
-- name: DeleteUserFlight :execrows
DELETE FROM user_flights WHERE id = $1 AND user_id = $2;
```

`AddUserFlight` là `:execrows`: trả số dòng thật sự thêm. 0 dòng nghĩa là chuyến đã có, service đổi thành
lỗi 409 `flight_exists`. `DeleteUserFlight` xoá theo `id` **và** `user_id`: người này không xoá được chuyến của người khác
dù đoán đúng id.

Chạy:

```bash
make migrate
make sqlc
```

### Bước 3: Nạp lịch bay mẫu

Thêm vào `backend/internal/db/queries/seed.sql`:

```sql
-- name: UpsertFlight :exec
INSERT INTO flights (code, airline, origin, destination, dep_local, duration_minutes, delay_minutes, gate)
VALUES (sqlc.arg('code'), sqlc.arg('airline'), sqlc.arg('origin'), sqlc.arg('destination'),
        sqlc.arg('dep_local')::text::time, sqlc.arg('duration_minutes'), sqlc.arg('delay_minutes'), sqlc.arg('gate'))
ON CONFLICT (code) DO UPDATE
SET airline = EXCLUDED.airline, origin = EXCLUDED.origin, destination = EXCLUDED.destination,
    dep_local = EXCLUDED.dep_local, duration_minutes = EXCLUDED.duration_minutes,
    delay_minutes = EXCLUDED.delay_minutes, gate = EXCLUDED.gate;
```

`sqlc.arg('dep_local')::text::time`: sqlc sinh tham số kiểu `string` ("08:00") thay vì `pgtype.Time` khó dùng; Postgres
tự đổi chữ sang `time`. Thêm mảng `flights` vào `backend/cmd/seed/data.json` (19 chuyến: mã, hãng, đi, đến,
`dep_local`, `duration_minutes`, `delay_minutes`, `gate`), khai báo struct `Flights` trong `seedData` rồi gọi `UpsertFlight` cho từng dòng
trước `tx.Commit` (xem `backend/cmd/seed/main.go`). Chạy `make seed`.

Chiều dài chuyến lấy từ mockup, chỉnh cho đúng múi giờ: VN 300 SGN → NRT cất cánh 00:05, bay 345 phút, đến Tokyo
07:50 (giờ Nhật hơn Việt Nam 2 tiếng). Vài chuyến đêm (VN 416 đi Seoul 23:30, VJ 822 đi Tokyo 00:30) để bản đồ lúc
nào cũng có máy bay.

## Kiểm tra

```bash
make seed        # ...flights=19
make psql        # SELECT code, origin, destination, dep_local, duration_minutes FROM flights ORDER BY dep_local;
```

## Hay gặp lỗi

- **Lưu giờ bay bằng `timestamptz` của một ngày cụ thể**: phải thêm dữ liệu mỗi ngày, hoặc chuyến bay biến mất sau ngày
  đó. Lịch hàng ngày không có vấn đề này.
- **Quên múi giờ**: "đến lúc 07:50" là giờ ở đâu? Luôn hiển thị theo sân bay tương ứng.
