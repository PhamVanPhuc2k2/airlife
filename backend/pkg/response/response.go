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
