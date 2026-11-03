# Bài 12.02: Kiểm duyệt và quản lý khảo sát

> [← Bài trước](01-khung-quan-tri.md) · [Mục lục](../README.md) · [Bài sau →](03-don-hang-hoan-tien-nguoi-dung.md)

## Mục tiêu

Ẩn/hiện bình luận và trải nghiệm, xử lý góp ý, tạo/đóng/xoá khảo sát.

## Bạn sẽ học

- Ẩn bình luận con thì phải trừ `reply_count` của bình luận gốc (giống lúc người viết tự xoá).
- Thao tác **idempotent**: ẩn hai lần không trừ đôi.
- Không khôi phục mục người viết đã tự xoá.
- Vì sao phương án khảo sát không sửa được sau khi tạo.

## Viết code

Các hàm nằm trong [backend/internal/admin/admin.go](../../../backend/internal/admin/admin.go) và truy vấn trong [backend/internal/db/queries/admin.sql](../../../backend/internal/db/queries/admin.sql).

Đáng đọc kỹ:

```go
cm, err := q.AdminGetComment(ctx, id)      // SELECT … FOR UPDATE: khoá dòng trong transaction
if cm.Status == "deleted" { return 409 }     // người viết đã xoá: không khôi phục
if cm.Status == status    { return nil }     // đã ở trạng thái đó: không làm gì (idempotent)
… AddReplyCount(parent, ±1) …                // chỉ khi là bình luận con
```

- `FOR UPDATE` chặn hai biên tập viên cùng đổi một bình luận, tránh trừ `reply_count` hai lần.
- Khảo sát: tạo với **2–6 phương án**, bỏ phương án rỗng; `UpdateSurvey` chỉ đổi câu hỏi và trạng thái (`open/closed/hidden`). Đổi chữ một phương án đã có phiếu là làm sai ý người đã chọn; muốn đổi thì đóng và tạo mới.
- Xoá khảo sát xoá luôn phiếu (`ON DELETE CASCADE`), nên giao diện hỏi xác nhận kèm số phiếu.

## Kiểm tra

Xem bài 12.04: ẩn bình luận con làm `reply_count` từ 1 về 0, hiện lại về 1; ẩn lần hai vẫn 204 và không trừ thêm.

## Hay gặp lỗi

- **`reply_count` âm hoặc lệch** sau khi ẩn: thiếu `FOR UPDATE` hoặc không kiểm tra "đã ở trạng thái đó".
- **Khảo sát đã đóng vẫn bình chọn được**: kiểm tra `status = 'open'` nằm ở `Vote` (Phần 11), không phải ở giao diện.
