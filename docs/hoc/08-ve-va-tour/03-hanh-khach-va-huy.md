# Bài 8.03: Hành khách, tên không dấu, tuổi theo ngày bay, huỷ đơn

> [← Bài trước](02-giu-cho.md) · [Mục lục](../README.md) · [Bài sau →](04-tra-cho-va-thu-api.md)

## Mục tiêu

`PUT /me/bookings/{code}/details`: người liên hệ và từng hành khách; đơn chuyển "chờ thanh toán".
`POST /me/bookings/{code}/cancel`: huỷ và trả chỗ. `GET` một đơn, danh sách đơn.

## Bạn sẽ học

- Bỏ dấu tiếng Việt đúng cách bằng chuẩn hoá Unicode (`golang.org/x/text`).
- Tính tuổi theo **ngày khởi hành**, không phải hôm nay.
- Khoá dòng (`FOR UPDATE`) khi ghi nhiều bảng cho một đơn.
- Trả "số giây còn lại" thay vì để trình duyệt tự tính.

## Viết code

Code nằm trong `backend/internal/booking/booking.go` (bài 8.02). Đọc các hàm `SetDetails`,
`validateDetails`, `ageOn`, `PassportName`, `Cancel`, `Get`.

### Họ tên không dấu, `PassportName`

Vé máy bay, khách sạn nước ngoài cần tên như trên hộ chiếu: `NGUYEN VAN DUC`. Bỏ dấu bằng bảng thay thế
(`á→a`, `ầ→a`…) phải liệt kê hơn 130 ký tự. Unicode có sẵn cách:

1. **NFD** tách mỗi chữ có dấu thành chữ gốc + các dấu: `ệ` → `e` + dấu mũ + dấu nặng.
2. **Xoá các ký tự thuộc nhóm `Mn`** (dấu đi kèm chữ).
3. **NFC** gộp lại phần còn lại.

`đ` không phải "d có dấu" (nó là một chữ riêng), nên vẫn phải đổi tay. Gói `golang.org/x/text` đã có trong
`go.sum` (gói khác dùng gián tiếp); dùng trực tiếp thì chạy `make tidy`, nó chuyển từ `// indirect` thành
phụ thuộc thật trong `go.mod`.

### Tuổi theo ngày khởi hành

Bé 11 tuổi 11 tháng hôm nay, đến ngày bay đã 12 tuổi: phải trả giá người lớn. `ageOn(birth, departDate)`
so tháng rồi ngày để biết đã qua sinh nhật năm đó chưa. Bản đầu so `YearDay()` (ngày thứ mấy trong năm):
sai với năm nhuận, vì ngày 1/3 là ngày thứ 60 năm thường nhưng thứ 61 năm nhuận.

Số người lớn, trẻ em tính từ ngày sinh phải **khớp** lúc giữ chỗ: giá đã tính theo đó, và số ghế đã lấy.

### Khoá đơn khi điền

`LockBookingForUpdate` chọn đơn còn đang giữ **và chưa quá giờ**, kèm `FOR UPDATE`. Trong lúc xoá hành
khách cũ, thêm hành khách mới, đổi trạng thái, worker không thể hết hạn đơn này giữa chừng (nó phải chờ
khoá). Đơn đã quá giờ thì không chọn được, báo `booking_not_active`.

### Số giây còn lại, `ExpiresIn`

Trình duyệt đếm ngược 20 phút. Nếu dùng `expires_at` và đồng hồ máy khách, máy chạy nhanh 3 phút sẽ thấy
đơn hết hạn sớm 3 phút. Server tính `expires_in` (giây), trình duyệt đếm từ lúc nhận phản hồi. Làm tròn
**lên** (xem bài 8.06).

`Get` cũng coi đơn quá giờ là `expired` dù worker chưa kịp chạy: khách không bao giờ thấy đơn "còn giữ"
quá 20 phút.

### Handler, `backend/internal/booking/handler.go`

```go
package booking

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

func userID(r *http.Request) uuid.UUID {
	a, _ := auth.ActorFrom(r.Context())
	return a.UserID
}

func (h *Handler) reply(w http.ResponseWriter, r *http.Request, data any, err error) {
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, data)
}

// GET /products/{slug}/departures: hạng dịch vụ, lịch khởi hành, số chỗ còn (công khai)
func (h *Handler) Availability(w http.ResponseWriter, r *http.Request) {
	a, err := h.svc.Availability(r.Context(), chi.URLParam(r, "slug"))
	h.reply(w, r, a, err)
}

// POST /me/bookings  (header Idempotency-Key)  {"departure_id", "fare_id", "adults", "children"}
func (h *Handler) Hold(w http.ResponseWriter, r *http.Request) {
	var in HoldInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	b, err := h.svc.Hold(r.Context(), userID(r), r.Header.Get("Idempotency-Key"), in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, b)
}

// PUT /me/bookings/{code}/details  {"contact_name", "contact_phone", "contact_email", "passengers": [...]}
func (h *Handler) SetDetails(w http.ResponseWriter, r *http.Request) {
	var in DetailsInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	b, err := h.svc.SetDetails(r.Context(), userID(r), chi.URLParam(r, "code"), in)
	h.reply(w, r, b, err)
}

// POST /me/bookings/{code}/cancel
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	b, err := h.svc.Cancel(r.Context(), userID(r), chi.URLParam(r, "code"))
	h.reply(w, r, b, err)
}

// GET /me/bookings/{code}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	b, err := h.svc.Get(r.Context(), userID(r), chi.URLParam(r, "code"))
	h.reply(w, r, b, err)
}

// GET /me/bookings?cursor=…
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.List(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	h.reply(w, r, p, err)
}
```

## Kiểm tra

```bash
make tidy && make fmt && make lint
grep -n "golang.org/x/text" backend/go.mod   # không còn chữ // indirect
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Bé sinh 1/3/2016, bay 1/3/2028 (năm nhuận) bị tính 11 tuổi | So `YearDay()`; so tháng, ngày như `ageOn` |
| Tên "Đào" ra "ĐAO" | Quên đổi `đ`/`Đ` (không phải chữ có dấu nên NFD không tách được) |
| `go build` báo `golang.org/x/text/... is not in your go.mod file` | Chạy `make tidy` |
