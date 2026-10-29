# Bài 7.01: Schema bán hàng: sản phẩm, biến thể, giỏ, đơn hàng

> [← Phần 06](../06-ban-va-suu-tap/06-trang-suu-tap.md) · [Mục lục](../README.md) · [Bài sau →](02-truy-van-va-du-lieu-mau.md)

## Mục tiêu

Migration `000007_shop`: sản phẩm và biến thể, sản phẩm gắn trong video, yêu thích, giỏ hàng, đơn hàng.

Ba quyết định đã chốt với khách trước khi làm:

| Câu hỏi | Chốt |
|---|---|
| Biến thể sản phẩm | **Một thuộc tính**: mỗi biến thể một nhãn tự do ("100ml", "Hộp 6 món"), giá và tồn kho riêng |
| Thanh toán | **COD** (thanh toán khi nhận hàng) trước; thanh toán online ở Phần 09 |
| Giỏ của khách chưa đăng nhập | Lưu trong trình duyệt, **gộp vào giỏ trên server** khi đăng nhập |

Vé bay và tour (mockup: `isBooking`) cần ngày đi, số khách, hạng dịch vụ: hiện trong danh mục nhưng
đặt chỗ làm ở Phần 08.

## Bạn sẽ học

- Lưu tiền bằng số nguyên (đồng), không dùng số thực.
- Để database chặn dữ liệu sai bằng `CHECK`: tồn kho âm, tổng tiền lệch, đơn giao tận nhà thiếu địa chỉ.
- "Snapshot" dòng đơn hàng: chép lại tên, giá lúc đặt.
- Khoá chống đặt trùng (idempotency key) bằng `UNIQUE`.
- Ánh xạ kiểu `numeric` của PostgreSQL trong sqlc.

## Viết code

### Bước 1: Migration

```bash
make migrate-new name=shop
```

`backend/migrations/000007_shop.up.sql`:

```sql
-- Bán hàng (Phần 07): sản phẩm và biến thể, sản phẩm gắn trong video, yêu thích, giỏ hàng, đơn hàng.
-- Tiền lưu bằng bigint, đơn vị đồng (VND không có số lẻ). KHÔNG dùng float cho tiền: 0.1 + 0.2 ≠ 0.3.

CREATE TABLE products (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- goods: hàng hoá có biến thể, mua ngay (Phần 07).
    -- booking: vé bay, tour; cần ngày đi, số khách, hạng dịch vụ (Phần 08).
    kind           text NOT NULL CHECK (kind IN ('goods', 'booking')),
    category_slug  text NOT NULL REFERENCES categories (slug),
    -- Chip lọc (category_filters.slug): mien-thue, dac-san, ve-bay…
    tag            text NOT NULL,
    channel_id     uuid NOT NULL REFERENCES channels (id),
    name           text NOT NULL,
    description    text NOT NULL DEFAULT '', -- một hai câu, hiện trên thẻ
    body_html      text NOT NULL DEFAULT '', -- mô tả chi tiết, ĐÃ lọc bằng bluemonday khi ghi
    image_url      text NOT NULL,
    gallery        text[] NOT NULL DEFAULT '{}',
    -- Giá hiển thị trên thẻ ("từ 389.000₫"): giá thấp nhất của các biến thể đang bán. Lưu sẵn để
    -- lọc, sắp xếp không phải tính lại; nơi sửa biến thể (seed, trang quản trị) cập nhật cùng lúc.
    price          bigint NOT NULL CHECK (price >= 0),
    old_price      bigint CHECK (old_price > price),
    -- Cách nhận hàng được phép: gate (cửa ra máy bay), arrival (sân bay đến), home (tận nhà),
    -- evoucher (mã điện tử qua email: phòng chờ, fast-track)
    delivery_methods text[] NOT NULL DEFAULT '{}'
        CHECK (delivery_methods <@ ARRAY['gate', 'arrival', 'home', 'evoucher']),
    rating         numeric(2, 1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    rating_count   integer NOT NULL DEFAULT 0,
    sold_count     integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
    status         text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
    published_at   timestamptz NOT NULL DEFAULT now(),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (category_slug, tag) REFERENCES category_filters (category_slug, slug)
);
CREATE INDEX products_list_new_idx ON products (category_slug, published_at DESC, id DESC)
    WHERE status = 'published';
CREATE INDEX products_list_sold_idx ON products (category_slug, sold_count DESC, id DESC)
    WHERE status = 'published';
CREATE INDEX products_channel_idx ON products (channel_id) WHERE status = 'published';

-- Biến thể: MỘT thuộc tính (nhãn tự do: "100ml", "Hộp 6 món"), mỗi biến thể giá và tồn kho riêng.
-- Sản phẩm không có lựa chọn nào vẫn có đúng một biến thể ("Tiêu chuẩn"): giỏ hàng và đơn hàng
-- luôn trỏ tới biến thể, không phải xử lý hai trường hợp.
CREATE TABLE product_variants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    sku         text NOT NULL UNIQUE,
    label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
    price       bigint NOT NULL CHECK (price >= 0),
    old_price   bigint CHECK (old_price > price),
    -- Tồn kho không bao giờ âm: database chặn luôn, kể cả khi code có lỗi
    stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    sort_order  smallint NOT NULL DEFAULT 0,
    active      boolean NOT NULL DEFAULT true,
    UNIQUE (product_id, label)
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id, sort_order);

-- Sản phẩm xuất hiện trong video ("Sản phẩm trong video" ở trang xem, "Xuất hiện trong" ở trang
-- sản phẩm)
CREATE TABLE media_products (
    media_id   uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    sort_order smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (media_id, product_id)
);
CREATE INDEX media_products_product_idx ON media_products (product_id);

-- Yêu thích (tab "Yêu thích" ở Sưu tập)
CREATE TABLE favorites (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id, created_at DESC, product_id DESC);

-- Giỏ hàng của người đã đăng nhập (khách chưa đăng nhập: giỏ nằm trong trình duyệt). Mỗi người
-- một giỏ, nên không cần bảng carts riêng: dòng giỏ gắn thẳng vào user_id.
CREATE TABLE cart_items (
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    variant_id uuid NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
    quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, variant_id)
);

CREATE TABLE orders (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Mã cho người đọc (AL-7KQ2M9XA): in trên email, khách đọc qua điện thoại. Không lộ số thứ tự
    -- đơn (đối thủ không đoán được mỗi ngày bán bao nhiêu đơn).
    code             text NOT NULL UNIQUE,
    user_id          uuid NOT NULL REFERENCES users (id),
    -- pending: chờ xác nhận → confirmed → delivering → completed; hoặc cancelled
    status           text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'delivering', 'completed', 'cancelled')),
    payment_method   text NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod')),
    delivery_method  text NOT NULL CHECK (delivery_method IN ('gate', 'arrival', 'home', 'evoucher')),
    recipient_name   text NOT NULL,
    phone            text NOT NULL,
    flight_code      text, -- nhận tại cửa ra máy bay / sân bay đến
    flight_date      date,
    address          text, -- giao tận nhà
    note             text NOT NULL DEFAULT '',
    subtotal         bigint NOT NULL CHECK (subtotal >= 0),
    shipping_fee     bigint NOT NULL CHECK (shipping_fee >= 0),
    total            bigint NOT NULL CHECK (total = subtotal + shipping_fee),
    -- Khoá chống đặt trùng: trình duyệt gửi kèm mỗi lần bấm "Đặt hàng". Bấm hai lần, hay mạng
    -- chập chờn gửi lại, vẫn chỉ ra MỘT đơn.
    idempotency_key  text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    cancelled_at     timestamptz,
    UNIQUE (user_id, idempotency_key),
    CHECK (delivery_method <> 'home' OR address IS NOT NULL),
    CHECK (delivery_method NOT IN ('gate', 'arrival') OR (flight_code IS NOT NULL AND flight_date IS NOT NULL))
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC, id DESC);

-- Dòng đơn hàng CHÉP LẠI tên, nhãn biến thể, ảnh, đơn giá tại thời điểm đặt (snapshot): sau này
-- sản phẩm đổi giá, đổi tên hay bị xoá thì đơn cũ vẫn đúng như lúc khách mua.
CREATE TABLE order_items (
    order_id      uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    variant_id    uuid REFERENCES product_variants (id) ON DELETE SET NULL,
    product_slug  text NOT NULL,
    product_name  text NOT NULL,
    variant_label text NOT NULL,
    image_url     text NOT NULL,
    unit_price    bigint NOT NULL CHECK (unit_price >= 0),
    quantity      integer NOT NULL CHECK (quantity > 0),
    line_total    bigint NOT NULL CHECK (line_total = unit_price * quantity),
    position      smallint NOT NULL,
    PRIMARY KEY (order_id, position)
);
```

`backend/migrations/000007_shop.down.sql`:

```sql
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS media_products;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
```

Đọc kỹ:

- **Tiền là `bigint` (đồng)**: VND không có số lẻ. Số thực (`float`, `real`) không biểu diễn chính xác
  được nhiều số thập phân, cộng dồn sẽ lệch vài đồng. Kể cả tiền tệ có số lẻ (USD) người ta vẫn lưu số
  nguyên theo đơn vị nhỏ nhất (cent).
- **`products.price` là giá "từ"**: giá thấp nhất của các biến thể, lưu sẵn để lọc và sắp xếp nhanh. Nơi
  sửa biến thể (seed, trang quản trị Phần 12) phải cập nhật cột này cùng lúc.
- **Sản phẩm không có lựa chọn vẫn có một biến thể** ("Tiêu chuẩn"): giỏ và đơn luôn trỏ tới biến thể, code
  không phải xử lý hai trường hợp.
- **`FOREIGN KEY (category_slug, tag) REFERENCES category_filters`**: chip lọc của sản phẩm phải là chip có
  thật của đúng chuyên mục (cần `UNIQUE (category_slug, slug)` ở bảng kia, đã có từ Phần 02).
- **`stock >= 0`, `total = subtotal + shipping_fee`, `line_total = unit_price * quantity`**: code có lỗi
  thì database từ chối, không lưu dữ liệu sai.
- **`CHECK` theo cách nhận hàng**: giao tận nhà phải có địa chỉ; nhận ở sân bay phải có số hiệu và ngày bay.
- **`order_items` chép lại tên, ảnh, đơn giá**: sản phẩm đổi giá hay bị xoá thì đơn cũ vẫn đúng như lúc
  mua. `variant_id ... ON DELETE SET NULL`: xoá biến thể không xoá dòng đơn.
- **`UNIQUE (user_id, idempotency_key)`**: cùng một lần bấm "Đặt hàng" chỉ ra một đơn (bài 7.05).
- **`orders.user_id` không có `ON DELETE CASCADE`**: đơn hàng là chứng từ, không được tự mất khi xoá tài khoản.

```bash
make migrate
make migrate-down && make migrate   # thử cả chiều xuống
```

### Bước 2: Kiểu `numeric` trong sqlc

Cột `rating numeric(2,1)` (4,8 sao) được sqlc sinh thành `pgtype.Numeric`, phải gọi hàm mới đổi ra số
được. Thêm vào cuối khối `overrides` trong `backend/sqlc.yaml`:

```yaml
          # numeric chỉ dùng cho điểm đánh giá (4,8 sao), đổi sang float64 cho dễ dùng.
          # TIỀN KHÔNG dùng numeric/float: tiền là bigint (đồng), xem migrations/000007_shop.up.sql
          - db_type: pg_catalog.numeric
            go_type: float64
```

Điểm đánh giá chỉ để hiển thị, sai số của `float64` không ảnh hưởng gì. Với tiền thì không được làm vậy.

## Kiểm tra

```bash
make psql
```

```sql
\d products
-- Thử CHECK: tồn kho âm
UPDATE product_variants SET stock = -1;
-- (chưa có dòng nào nên UPDATE 0; sau bài 7.02 chạy lại sẽ thấy lỗi product_variants_stock_check)
\q
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `there is no unique constraint matching given keys for referenced table "category_filters"` | Khoá ngoại hai cột cần `UNIQUE (category_slug, slug)` ở bảng được trỏ tới |
| Trong Go thấy `Rating pgtype.Numeric` | Thiếu override `pg_catalog.numeric` hoặc chưa chạy lại `make sqlc` |
| `make migrate-down` lỗi khoá ngoại | File down phải xoá bảng con trước (`order_items` trước `orders`…) |
