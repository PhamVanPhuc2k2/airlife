// Package request đọc dữ liệu client gửi lên.
package request

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

// Tối đa 1 MB cho body JSON: chặn client gửi body khổng lồ làm tràn bộ nhớ server.
const maxBody = 1 << 20

// DecodeJSON đọc body JSON vào v. Trường lạ không có trong struct → lỗi, để phát hiện sớm
// frontend gửi sai tên trường (vd. "displayName" thay vì "display_name").
func DecodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return apperr.Invalid("body_too_large", "Dữ liệu gửi lên quá lớn")
		}
		return apperr.Invalid("invalid_json", "Dữ liệu gửi lên không đúng định dạng")
	}
	return nil
}
