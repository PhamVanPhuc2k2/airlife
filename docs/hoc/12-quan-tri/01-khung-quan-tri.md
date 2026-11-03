# Bài 12.01: Khung quản trị: phân quyền, nhật ký, hoàn tiền

> [← Phần 11](../11-y-kien/06-frontend-y-kien.md) · [Mục lục](../README.md) · [Bài sau →](02-kiem-duyet-va-khao-sat.md)

## Mục tiêu

Dựng nền cho khu `/admin`: middleware phân quyền theo vai trò, bảng nhật ký thao tác, cột ghi nhận hoàn tiền.

## Bạn sẽ học

- Vì sao phân quyền phải đọc vai trò từ **database** mỗi request, không tin vai trò trong access token.
- Hai tầng quyền: `editor` (nội dung, kiểm duyệt) và `admin` (tiền, đơn hàng, người dùng).
- Bảng nhật ký chỉ thêm (`audit_log`) và hàm `audit` dùng chung trong transaction.
- Phân trang **offset** cho trang quản trị (khác phân trang con trỏ của trang công khai).

## Viết code

### Bước 1: Migration, `backend/migrations/000012_admin.up.sql`

```sql
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
```

- `refund_required` đã có từ Phần 09; nay thêm `refunded_at/by/note` để phân biệt "chưa từng cần hoàn" với "đã hoàn xong".
- `audit_log` dùng `bigint GENERATED ALWAYS AS IDENTITY`: id tăng dần, không ai tự chèn id được. Không có UPDATE/DELETE trong code.

### Bước 2: Phân quyền, `backend/internal/admin/admin.go` (hàm `RequireRole`)

```go
u, err := q.AdminRole(r.Context(), actor.UserID)
if u.Status != "active" || !contains(roles, u.Role) { → 403 }
```

Access token sống 15 phút và chứa vai trò. Nếu tin token thì admin vừa bị hạ quyền hoặc khoá vẫn thao tác được tối đa 15 phút. Đọc từ database tốn một truy vấn theo khoá chính mỗi request quản trị, đổi lại quyền thu hồi **tức thì**.

### Bước 3: Gắn route, `backend/internal/server/server.go`

```go
r.Route("/admin", func(r chi.Router) {
    r.Use(requireAuth)
    r.Group(func(r chi.Router) { r.Use(admin.RequireRole(q, log, admin.Staff...));  /* bình luận, trải nghiệm, góp ý, khảo sát */ })
    r.Group(func(r chi.Router) { r.Use(admin.RequireRole(q, log, admin.Admins...)); /* stats, đơn hàng, hoàn tiền, người dùng */ })
})
```

`requireAuth` chạy trước (401 nếu chưa đăng nhập), rồi `RequireRole` (403 nếu thiếu quyền).

### Bước 4: Phân trang và nhật ký

- `Paging{Page, Size}` kiểu `int32` (khớp `LIMIT/OFFSET` của sqlc); handler giới hạn trang ≤ 10000, cỡ ≤ 50. `count(*) OVER ()` trong cùng truy vấn trả tổng số dòng, không cần truy vấn đếm riêng.
- `Service.audit(ctx, q, actor, action, type, id, detail)` luôn nhận `q` của **transaction** đang chạy: thao tác và dòng nhật ký cùng thành công hoặc cùng huỷ.

## Kiểm tra

Đặt vai trò bằng SQL rồi thử (bài 12.04): chưa đăng nhập → 401; `user` → 403; `editor` vào `/admin/stats` → 403, vào `/admin/comments` → 200.

## Hay gặp lỗi

- **gosec G115 `int -> int32`** khi truyền `LIMIT` cho sqlc: để `Paging` dùng `int32` ngay từ đầu và ép kiểu sau khi đã kiểm tra khoảng.
- **Quên `requireAuth` trước `RequireRole`**: khi đó `ActorFrom` trả `ok=false`; `RequireRole` vẫn trả 401 nhưng đừng dựa vào đó, hãy xếp đúng thứ tự.
