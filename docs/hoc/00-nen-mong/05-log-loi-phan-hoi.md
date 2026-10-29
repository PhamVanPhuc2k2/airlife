# Bài 0.05: Log, lỗi theo ngữ nghĩa, định dạng phản hồi JSON

> [← Bài trước](04-cau-hinh-viper.md) · [Mục lục](../README.md) · [Bài sau →](06-ket-noi-ha-tang.md)

## Mục tiêu

Ba gói nền mà mọi handler sẽ dùng:
- `pkg/logger`: log có cấu trúc bằng `slog`.
- `pkg/apperr`: lỗi mang ý nghĩa nghiệp vụ (không tìm thấy, dữ liệu sai, không có quyền…).
- `pkg/response`: mọi phản hồi JSON của API cùng một khuôn.

## Bạn sẽ học

- Log có cấu trúc (`key=value`) thay vì chuỗi tự do, để lọc được theo `request_id`.
- **Tầng service không biết HTTP.** Service trả `apperr.NotFound(...)`; chỉ tầng handler đổi nó thành 404.
- Lỗi hệ thống (DB sập, mất mạng) **không bao giờ** lộ nội dung ra client. Client thấy câu chung
  chung kèm `request_id`; chi tiết nằm trong log.

## Viết code

### Bước 1: `pkg/logger/logger.go`

`log/slog` có sẵn trong thư viện chuẩn từ Go 1.21, không cần cài.

```go
// Package logger tạo *slog.Logger dùng chung cho api và worker.
//
// slog có sẵn trong thư viện chuẩn của Go (từ 1.21), không cần cài thêm.
// Log có cấu trúc (key=value hoặc JSON) thay vì chuỗi tự do, để sau này lọc được
// theo request_id, user_id… trên công cụ xem log.
package logger

import (
	"log/slog"
	"os"
	"strings"
)

// New trả logger ghi ra stdout. format "json" cho production (máy đọc),
// mọi giá trị khác cho ra dạng text (người đọc khi dev).
func New(level, format string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var h slog.Handler
	if strings.EqualFold(format, "json") {
		h = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		h = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(h)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
```

Cùng một dòng log, hai định dạng:

```text
# text (dev): người đọc
time=2026-10-29T11:03:05+07:00 level=INFO msg=http method=GET path=/healthz status=200

# json (production): máy đọc, công cụ xem log lọc được theo từng trường
{"time":"2026-10-29T11:03:05+07:00","level":"INFO","msg":"http","method":"GET","path":"/healthz","status":200}
```

### Bước 2: `pkg/apperr/apperr.go`

```go
// Package apperr định nghĩa lỗi theo ngữ nghĩa nghiệp vụ.
//
// Tầng service trả về apperr.NotFound(...), apperr.Invalid(...)… mà không cần biết
// HTTP là gì. Chỉ tầng handler (pkg/response) mới đổi Kind sang mã HTTP.
// Lỗi không phải *apperr.Error (lỗi DB, lỗi mạng…) luôn bị coi là Internal và
// KHÔNG được lộ nội dung ra client.
package apperr

import (
	"errors"
	"fmt"
)

type Kind int

const (
	KindInternal     Kind = iota // 500: lỗi hệ thống, không lộ chi tiết
	KindInvalid                  // 400: dữ liệu gửi lên sai
	KindUnauthorized             // 401: chưa đăng nhập / token hỏng
	KindForbidden                // 403: đã đăng nhập nhưng không có quyền
	KindNotFound                 // 404
	KindConflict                 // 409: trùng (email đã tồn tại…)
	KindTooMany                  // 429: bị rate limit
)

type Error struct {
	Kind    Kind
	Code    string            // mã ổn định cho frontend xử lý, vd. "media_not_found"
	Message string            // câu thông báo cho người dùng
	Fields  map[string]string // lỗi theo từng trường của form (chỉ dùng với KindInvalid)
	Err     error             // lỗi gốc, chỉ để ghi log
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Err)
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }

// As lấy *Error ra từ chuỗi lỗi đã bọc (fmt.Errorf("...: %w", err)).
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

func Invalid(code, msg string) *Error { return &Error{Kind: KindInvalid, Code: code, Message: msg} }

func Unauthorized(code, msg string) *Error {
	return &Error{Kind: KindUnauthorized, Code: code, Message: msg}
}

func Forbidden(code, msg string) *Error { return &Error{Kind: KindForbidden, Code: code, Message: msg} }

func NotFound(code, msg string) *Error { return &Error{Kind: KindNotFound, Code: code, Message: msg} }

func Conflict(code, msg string) *Error { return &Error{Kind: KindConflict, Code: code, Message: msg} }

func TooMany(code, msg string) *Error { return &Error{Kind: KindTooMany, Code: code, Message: msg} }

// Internal bọc lỗi hệ thống. Client chỉ thấy câu chung chung, lỗi gốc nằm trong log.
func Internal(err error) *Error {
	return &Error{Kind: KindInternal, Code: "internal", Message: "Có lỗi xảy ra, vui lòng thử lại sau", Err: err}
}

// WithFields gắn lỗi theo từng trường, vd. {"email": "Email không hợp lệ"}.
func (e *Error) WithFields(fields map[string]string) *Error {
	e.Fields = fields
	return e
}
```

Điểm chính:

- **`Code`** là chuỗi ổn định cho frontend rẽ nhánh (`"email_taken"` → hiện lỗi dưới ô email).
  **`Message`** là câu cho người dùng đọc, có thể đổi câu chữ thoải mái.
- **`Err`** giữ lỗi gốc để ghi log; `Unwrap()` cho phép `errors.Is` / `errors.As` nhìn xuyên qua.
- **`As`** dùng `errors.As`, nên lỗi đã bị bọc nhiều lớp (`fmt.Errorf("lấy media: %w", err)`)
  vẫn lấy ra được `*apperr.Error` bên trong.

### Bước 3: `pkg/response/response.go`

Gói này dùng `middleware.GetReqID` của go-chi để lấy request_id, nên cài chi trước:

```bash
go get github.com/go-chi/chi/v5@v5.5.0
```

```go
// Package response ghi phản hồi JSON theo một khuôn duy nhất cho toàn API.
//
// Thành công:  {"data": ..., "meta": {...}}       (meta chỉ có khi phân trang)
// Thất bại:    {"error": {"code": "...", "message": "...", "fields": {...}, "request_id": "..."}}
//
// Frontend chỉ cần kiểm tra có "error" hay không, và dùng "code" để rẽ nhánh.
package response

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

type body struct {
	Data  any        `json:"data,omitempty"`
	Meta  any        `json:"meta,omitempty"`
	Error *errorBody `json:"error,omitempty"`
}

type errorBody struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	Fields    map[string]string `json:"fields,omitempty"`
	RequestID string            `json:"request_id,omitempty"`
}

func JSON(w http.ResponseWriter, status int, data any) {
	write(w, status, body{Data: data})
}

func OK(w http.ResponseWriter, data any) {
	JSON(w, http.StatusOK, data)
}

func Created(w http.ResponseWriter, data any) {
	JSON(w, http.StatusCreated, data)
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// List dùng cho danh sách có phân trang.
func List(w http.ResponseWriter, data, meta any) {
	write(w, http.StatusOK, body{Data: data, Meta: meta})
}

// Error đổi lỗi thành phản hồi HTTP. Lỗi Internal được ghi log đầy đủ (kèm lỗi gốc),
// còn client chỉ nhận câu thông báo chung.
func Error(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	e, ok := apperr.As(err)
	if !ok {
		e = apperr.Internal(err)
	}

	reqID := middleware.GetReqID(r.Context())
	if e.Kind == apperr.KindInternal {
		log.ErrorContext(r.Context(), "lỗi hệ thống",
			"err", err, "request_id", reqID, "method", r.Method, "path", r.URL.Path)
	}

	write(w, statusOf(e.Kind), body{Error: &errorBody{
		Code:      e.Code,
		Message:   e.Message,
		Fields:    e.Fields,
		RequestID: reqID,
	}})
}

func statusOf(k apperr.Kind) int {
	switch k {
	case apperr.KindInvalid:
		return http.StatusBadRequest
	case apperr.KindUnauthorized:
		return http.StatusUnauthorized
	case apperr.KindForbidden:
		return http.StatusForbidden
	case apperr.KindNotFound:
		return http.StatusNotFound
	case apperr.KindConflict:
		return http.StatusConflict
	case apperr.KindTooMany:
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

func write(w http.ResponseWriter, status int, b body) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// Lỗi encode ở đây thường là client đã ngắt kết nối; header đã gửi nên không làm gì thêm được.
	_ = json.NewEncoder(w).Encode(b)
}
```

Điểm chính:

- Mọi phản hồi có **đúng một** trong hai khoá `data` hoặc `error`. Frontend chỉ cần kiểm tra
  `if (body.error)`.
- `omitempty` bỏ khoá rỗng, nên phản hồi thành công không có `"error": null`.
- Lỗi không phải `*apperr.Error` (lỗi pgx, lỗi mạng…) bị đổi thành `Internal`: log đầy đủ ở
  server, client chỉ nhận "Có lỗi xảy ra" + `request_id`. Người dùng gửi `request_id` cho
  bạn là tìm ra đúng dòng log.

Ví dụ phản hồi lỗi:

```json
{"error":{"code":"media_not_found","message":"Không tìm thấy video","request_id":"may/abc123-000042"}}
```

## Kiểm tra

```bash
cd backend && go mod tidy && go build ./... && go vet ./...
```

Không in gì là đúng. Các gói này được dùng thật ở bài 0.07, 0.08.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trả `err.Error()` thẳng ra client | Lộ tên bảng, câu SQL, địa chỉ nội bộ. Luôn đi qua `response.Error` |
| `errors.As` không bắt được lỗi | Biến đích phải là con trỏ tới kiểu lỗi: `var e *apperr.Error; errors.As(err, &e)` |
| Gọi `w.WriteHeader` sau khi đã ghi body | Go in cảnh báo `superfluous response.WriteHeader call`. Header phải đặt **trước** khi ghi body |
