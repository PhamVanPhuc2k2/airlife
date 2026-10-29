// Package pagination: con trỏ phân trang dạng chuỗi "đen" (opaque) dùng chung cho mọi danh sách.
//
// Con trỏ là vị trí dòng cuối của trang trước (vd. {published_at, id}), mã hoá JSON → base64.
// Client chỉ gửi lại nguyên văn, không tự ghép hay sửa, nên đổi cấu trúc bên trong không làm
// hỏng client. Xem bài 2.05 về phân trang con trỏ.
package pagination

import (
	"encoding/base64"
	"encoding/json"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

var errInvalid = apperr.Invalid("invalid_cursor", "Con trỏ phân trang không hợp lệ")

// Encode mã hoá con trỏ. v là struct đơn giản (thời gian, số, uuid) nên Marshal không thể lỗi.
func Encode(v any) string {
	b, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Decode giải mã s vào v (con trỏ tới struct). s rỗng = trang đầu: trả false, không lỗi.
func Decode(s string, v any) (bool, error) {
	if s == "" {
		return false, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return false, errInvalid
	}
	if err := json.Unmarshal(b, v); err != nil {
		return false, errInvalid
	}
	return true, nil
}
