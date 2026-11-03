# Bài 11.03: Khảo sát: một người một phiếu

> [← Bài trước](02-trai-nghiem.md) · [Mục lục](../README.md) · [Bài sau →](04-goi-y-va-turnstile.md)

## Mục tiêu

Liệt kê khảo sát kèm kết quả và phiếu của người xem; nhận bình chọn đúng một lần.

## Bạn sẽ học

- Gom các dòng join phẳng (khảo sát × phương án) thành cấu trúc lồng nhau trong Go.
- Tính phần trăm bằng số nguyên có làm tròn.
- Biến lỗi của database (23503) thành lỗi nghiệp vụ dễ hiểu.
- Quyết định "không cho đổi phiếu" và lý do.

## Viết code

Hàm `Surveys`, `Vote` và `isForeignKey` nằm trong cùng file service ở bài 11.02 ([backend/internal/opinion/opinion.go](../../../backend/internal/opinion/opinion.go)). Phần đáng đọc kỹ:

```go
// Phần trăm làm tròn bằng số nguyên: (votes*100 + total/2) / total
sv.Options[j].Percent = (sv.Options[j].Votes*100 + sv.Total/2) / sv.Total
```

- Cộng `total/2` trước khi chia nguyên là cách làm tròn "half up" mà không dùng số thực. Tổng các phần trăm có thể là 99 hoặc 101 (giống mọi trang khảo sát); chấp nhận được.
- `ListSurveyOptions` trả các dòng đã sắp theo `s.position, s.created_at, s.id, o.position`, nên chỉ cần so `out[len(out)-1].ID` với dòng hiện tại để biết có sang khảo sát mới chưa.
- `Vote` kiểm tra theo thứ tự: email đã xác minh → khảo sát tồn tại và chưa ẩn → còn mở → ghi phiếu → đọc kết quả `CastVote`:
  - 0 dòng: 409 `already_voted`.
  - Lỗi 23503 (khoá ngoại ghép): 400 `invalid_option`.
- **Không cho đổi phiếu.** Kết quả công khai; cho đổi ý thì số phiếu nhảy, và có thể bị lợi dụng. Muốn cho đổi thì thêm `UPDATE`, quyết định này để khách chốt.

## Kiểm tra

Xem bài 11.05.

## Hay gặp lỗi

- **Bình chọn thành công nhưng giao diện không đổi**: frontend phải tải lại `["surveys"]` sau khi bình chọn (kể cả khi lỗi `already_voted`, để hiện đúng phiếu đã chọn).
- **`pq`/`pgconn` lỗi không bắt được bằng `==`**: dùng `errors.As(err, &pgErr)` rồi so `pgErr.Code`.
