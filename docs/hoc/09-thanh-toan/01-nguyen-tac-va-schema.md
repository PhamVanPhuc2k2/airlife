# Bài 9.01: Nguyên tắc thanh toán online và schema

> [← Phần 08](../08-ve-va-tour/06-trang-giu-cho-va-nghiem-thu.md) · [Mục lục](../README.md) · [Bài sau →](02-cong-thanh-toan-va-chu-ky.md)

## Mục tiêu

Chuẩn bị bảng `payments`, `payment_events` và các truy vấn cho thanh toán online của đơn đặt vé, tour.

Hai quyết định đã chốt với khách:

| Câu hỏi | Chốt |
|---|---|
| Cổng nào trước | **Cổng giả lập** (chưa có tài khoản sandbox). Làm đủ luồng thật; gắn VNPay/MoMo/ZaloPay sau chỉ cần viết thêm một adapter |
| Áp dụng cho gì | **Vé, tour** trả online. Hàng hoá giữ COD |

## Bạn sẽ học

Bốn nguyên tắc của mọi hệ thống thanh toán (bài này chỉ nói; các bài sau lần lượt làm):

1. **Tiền là chuyện của cổng.** Trình duyệt của khách nói "tôi trả rồi" thì không đáng tin. Chỉ **webhook
   có chữ ký** (cổng gọi vào API của ta), hoặc câu trả lời của cổng khi ta hỏi lại, mới xác nhận được đơn.
2. **Webhook không đáng tin về thứ tự và số lần.** Nó có thể đến trễ, đến hai lần, đến sau khi khách đã
   về trang của ta, hoặc không đến. Xử lý phải chạy lại nhiều lần mà kết quả không đổi (idempotent).
3. **Lưới an toàn: đối soát.** Mất webhook thì ta chủ động hỏi cổng.
4. **Đã nhận tiền mà không giao được dịch vụ thì không được nuốt.** Đánh dấu cần hoàn tiền.

## Viết code

### Bước 1: Migration

```bash
make migrate-new name=payments
```

`backend/migrations/000009_payments.up.sql`:

```sql
-- Thanh toán online (Phần 09). Hiện áp dụng cho đơn đặt vé, tour (bookings); hàng hoá giữ COD.
-- Cổng thanh toán nằm sau một interface (pkg/payment), nên bảng không gắn với cổng cụ thể nào.

CREATE TABLE payments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Mã giao dịch phía Airlife (PM-7KQ2M9XA): gửi cho cổng làm "mã đơn của người bán"; cổng gọi
    -- webhook về thì ta tìm lại payment bằng mã này
    code            text NOT NULL UNIQUE,
    user_id         uuid NOT NULL REFERENCES users (id),
    booking_id      uuid NOT NULL REFERENCES bookings (id),
    provider        text NOT NULL,
    provider_txn    text, -- mã giao dịch của cổng; có sau khi tạo phiên thanh toán
    amount          bigint NOT NULL CHECK (amount > 0),
    -- pending: đã tạo phiên, chờ khách trả. succeeded: cổng báo đã nhận tiền. failed: khách trả không
    -- được / sai số tiền / trả trùng. expired: khách mở phiên mới nên phiên cũ bị thay.
    status          text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
    failure_reason  text,
    -- Đã nhận tiền nhưng không giao được dịch vụ (đơn đã huỷ, hết chỗ, trả trùng, sai số tiền):
    -- nhân viên phải hoàn tiền bằng tay. Cờ này là danh sách việc cần làm của trang quản trị (Phần 12).
    refund_required boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    paid_at         timestamptz,
    CHECK (status <> 'succeeded' OR paid_at IS NOT NULL)
);
-- Mỗi đơn chỉ có MỘT khoản thanh toán thành công. Database chặn, không chỉ code.
CREATE UNIQUE INDEX payments_one_success_per_booking ON payments (booking_id) WHERE status = 'succeeded';
CREATE INDEX payments_booking_idx ON payments (booking_id, created_at DESC);
-- Đối soát: chỉ quét các khoản còn chờ
CREATE INDEX payments_pending_idx ON payments (created_at) WHERE status = 'pending';
CREATE INDEX payments_refund_idx ON payments (created_at) WHERE refund_required;

-- Nhật ký webhook đã xử lý. Cổng gọi lại cùng một sự kiện (mạng chậm, ta trả lời chậm) thì khoá chính
-- này chặn xử lý hai lần.
CREATE TABLE payment_events (
    provider    text NOT NULL,
    event_id    text NOT NULL,
    payment_id  uuid NOT NULL REFERENCES payments (id),
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, event_id)
);
```

`backend/migrations/000009_payments.down.sql`:

```sql
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payments;
```

- **`payments_one_success_per_booking`**: chỉ mục `UNIQUE ... WHERE status = 'succeeded'`. Mỗi đơn có
  nhiều lần thử thanh toán (thất bại, phiên cũ), nhưng tối đa **một** khoản thành công. Database chặn
  luôn cả khi code có lỗi.
- **`payment_events (provider, event_id)` khoá chính**: cổng gửi lại cùng sự kiện thì `INSERT` thứ hai
  không thêm được dòng; code dựa vào đó để biết "xử lý rồi" (bài 9.03).
- **`refund_required`**: danh sách việc cho nhân viên hoàn tiền (trang quản trị Phần 12). Chỉ mục một phần
  `WHERE refund_required` giữ truy vấn đó nhanh dù bảng lớn.
- **`CHECK (status <> 'succeeded' OR paid_at IS NOT NULL)`**: thành công thì phải có thời điểm trả.

```bash
make migrate && make migrate-down && make migrate
```

### Bước 2: Truy vấn, `backend/internal/db/queries/payments.sql`

```sql
-- Thanh toán online (Phần 09).

-- Khoá đơn đặt chỗ của người dùng trước khi tạo phiên thanh toán: hai request "Thanh toán" cùng
-- lúc phải chờ nhau, không sinh hai phiên song song.
-- name: GetBookingForPayment :one
SELECT id, code, status, expires_at, total, product_name
FROM bookings WHERE user_id = $1 AND code = $2
FOR UPDATE;

-- Phiên cũ của đơn này (khách bấm "Thanh toán" lại): coi như hết hạn
-- name: ExpirePendingPayments :exec
UPDATE payments SET status = 'expired', updated_at = now()
WHERE booking_id = $1 AND status = 'pending';

-- Kéo dài giữ chỗ để khách kịp trả tiền ở trang của cổng (không bao giờ rút ngắn)
-- name: ExtendHold :exec
UPDATE bookings SET expires_at = GREATEST(expires_at, sqlc.arg('until')::timestamptz), updated_at = now()
WHERE id = sqlc.arg('id');

-- name: CreatePayment :one
INSERT INTO payments (code, user_id, booking_id, provider, amount)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- name: SetPaymentTxn :exec
UPDATE payments SET provider_txn = $2, updated_at = now() WHERE id = $1;

-- name: FailPayment :exec
UPDATE payments SET status = 'failed', failure_reason = $2, refund_required = $3, updated_at = now()
WHERE id = $1;

-- Khoá khoản thanh toán khi xử lý sự kiện: webhook và đối soát cùng đến một lúc thì xử lý lần lượt
-- name: GetPaymentForUpdate :one
SELECT id, booking_id, user_id, status, amount, provider
FROM payments WHERE code = $1
FOR UPDATE;

-- Ghi sự kiện đã xử lý. 0 dòng = sự kiện này đã xử lý rồi.
-- name: InsertPaymentEvent :execrows
INSERT INTO payment_events (provider, event_id, payment_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: MarkPaymentSucceeded :exec
UPDATE payments
SET status = 'succeeded', paid_at = now(), provider_txn = COALESCE(sqlc.narg('txn'), provider_txn),
    refund_required = $2, failure_reason = NULL, updated_at = now()
WHERE id = $1;

-- Khoá đơn đặt chỗ theo id khi áp kết quả thanh toán
-- name: GetBookingByIDForUpdate :one
SELECT b.id, b.code, b.status, b.departure_id, b.fare_id, b.adults, b.children, b.product_name,
       b.fare_label, b.depart_date, b.total, b.user_id, b.contact_name, b.contact_email
FROM bookings b WHERE b.id = $1
FOR UPDATE;

-- name: ConfirmBooking :exec
UPDATE bookings SET status = 'confirmed', updated_at = now() WHERE id = $1;

-- Khoản thanh toán đại diện cho đơn (trang đặt chỗ hiện kết quả): khoản đã thành công nếu có,
-- không thì khoản mới nhất. Khách mở phiên mới sau khi đã trả ở phiên cũ thì trang vẫn phải báo
-- "đã thanh toán", không phải "đang chờ" của phiên mới nhất.
-- name: GetLatestPayment :one
SELECT status, refund_required, paid_at FROM payments
WHERE booking_id = $1
ORDER BY (status = 'succeeded') DESC, created_at DESC
LIMIT 1;

-- Đối soát: khoản còn "chờ" quá min_age_seconds giây mà chưa nhận được webhook (mất webhook, server tắt lúc cổng
-- gọi). Quá 24 giờ thì bỏ: phiên của cổng đã hết hạn từ lâu.
-- name: ListPendingPayments :many
SELECT code, provider, provider_txn
FROM payments
WHERE status = 'pending' AND provider_txn IS NOT NULL
  AND created_at < now() - make_interval(secs => sqlc.arg('min_age_seconds')::integer)
  AND created_at > now() - interval '24 hours'
ORDER BY created_at
LIMIT 50;
```

- **`GetBookingForPayment ... FOR UPDATE`** và **`GetPaymentForUpdate ... FOR UPDATE`**: khoá dòng để các
  việc đụng cùng một đơn / khoản thanh toán xếp hàng (hai lần bấm "Thanh toán"; webhook và đối soát cùng đến).
- **`ExtendHold ... GREATEST`**: kéo dài giữ chỗ chứ không bao giờ rút ngắn.
- **`GetLatestPayment ... ORDER BY (status = 'succeeded') DESC`**: khách mở phiên mới sau khi đã trả ở
  phiên cũ; trang đặt chỗ phải báo "đã thanh toán", không phải "đang chờ" của phiên mới nhất (xem "Hay gặp lỗi").
- **`ListPendingPayments`** nhận số giây (`make_interval(secs => …)`): sqlc đổi kiểu `interval` thành
  `pgtype.Interval` khó dùng, số nguyên thì đơn giản.

```bash
make sqlc
```

## Kiểm tra

```sql
-- make psql
\d payments
SELECT indexname FROM pg_indexes WHERE tablename = 'payments';
-- payments_one_success_per_booking, payments_pending_idx, payments_refund_idx, ...
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `cannot use "3 minutes" as pgtype.Interval` | Truy vấn nhận `interval`; đổi sang `make_interval(secs => sqlc.arg('min_age_seconds')::integer)` |
| Đơn đã xác nhận nhưng trang vẫn hiện "đang chờ thanh toán" | `GetLatestPayment` lấy khoản mới nhất; ưu tiên khoản `succeeded` |
