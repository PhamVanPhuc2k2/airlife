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
