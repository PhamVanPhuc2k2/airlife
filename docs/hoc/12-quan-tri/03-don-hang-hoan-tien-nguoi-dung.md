# Bài 12.03: Đơn hàng, hoàn tiền, người dùng

> [← Bài trước](02-kiem-duyet-va-khao-sat.md) · [Mục lục](../README.md) · [Bài sau →](04-frontend-quan-tri.md)

## Mục tiêu

Chuyển trạng thái đơn hàng (huỷ thì trả kho), ghi nhận hoàn tiền thủ công, đổi vai trò và khoá người dùng.

## Bạn sẽ học

- **Máy trạng thái** của đơn: bảng `transitions`, và chuyển trạng thái có điều kiện trong `WHERE` để hai nhân viên bấm cùng lúc chỉ một người thắng.
- Huỷ đơn dùng lại đúng logic trả kho của khách tự huỷ.
- Hoàn tiền bắt buộc có ghi chú (mã giao dịch hoàn) để đối soát.
- Chặn tự khoá/tự đổi vai trò; khoá người dùng thì huỷ mọi phiên đăng nhập.

## Viết code

Hàm nằm trong [backend/internal/admin/commerce.go](../../../backend/internal/admin/commerce.go).

```go
var transitions = map[string][]string{
    "pending":    {"confirmed", "cancelled"},
    "confirmed":  {"delivering", "cancelled"},
    "delivering": {"completed"},
}
```

```sql
-- AdminTransitionOrder
UPDATE orders SET status = $to … WHERE code = $code AND status = $from RETURNING id;
```

- Service đọc trạng thái hiện tại, kiểm tra có trong `transitions`, rồi `UPDATE … AND status = $from`. Nếu giữa hai bước người khác đã đổi, `RETURNING` không có dòng → `409 state_changed` ("hãy tải lại trang").
- Huỷ (`to == "cancelled"`): `RestockOrder` + trừ lại `AddProductSold`, trong cùng transaction với đổi trạng thái.
- `MarkRefunded`: `UPDATE payments … WHERE code = $1 AND refund_required RETURNING id`; không có dòng → 409 `not_refundable` (đã hoàn rồi hoặc không cần hoàn), nên bấm hai lần không ghi đôi.
- `UpdateUser`: `id == actor.UserID` → 403 `self_change`. Trong cả hai trường hợp admin vẫn còn ít nhất một người: không ai tự hạ quyền mình được. Khoá thì gọi `sessions.RevokeAllForUser`: refresh token chết ngay (kiểm tra bằng `POST /auth/refresh` → 401) và đăng nhập báo `account_locked`.

## Kiểm tra

Xem bài 12.04.

## Hay gặp lỗi

- **Kho bị cộng hai lần khi huỷ**: trả kho phải nằm **sau** `UPDATE` có điều kiện trạng thái thành công, không đặt trước.
- **Sửa trực tiếp `payments.refund_required = false` bằng SQL**: mất dấu ai hoàn, hoàn lúc nào. Luôn đi qua API.
