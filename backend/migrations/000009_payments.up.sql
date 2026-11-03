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
