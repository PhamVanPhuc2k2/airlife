-- Quản trị (Phần 12): hoàn tiền thủ công và nhật ký thao tác của quản trị viên.

-- Hoàn tiền xong thì nhân viên ghi lại: ai làm, lúc nào, ghi chú (mã giao dịch hoàn…). Cờ
-- refund_required hạ xuống false; refunded_at cho biết "đã hoàn" khác với "chưa từng cần hoàn".
ALTER TABLE payments
    ADD COLUMN refunded_at timestamptz,
    ADD COLUMN refunded_by uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN refund_note text CHECK (refund_note IS NULL OR char_length(refund_note) <= 500);

-- Nhật ký: mọi thao tác thay đổi dữ liệu của người khác (ẩn bình luận, đổi vai trò, huỷ đơn…).
-- Chỉ thêm, không sửa, không xoá: để truy lại "ai đã làm gì".
CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    action      text NOT NULL,
    target_type text NOT NULL,
    target_id   text NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
