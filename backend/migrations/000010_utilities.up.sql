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
