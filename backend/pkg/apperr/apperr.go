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
