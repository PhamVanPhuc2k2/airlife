package payment

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// HeaderSignature: "t=<giây Unix>,v1=<hex HMAC-SHA256>".
const HeaderSignature = "X-Payment-Signature"

// Chữ ký ký lên "<t>.<nội dung>" bằng khoá bí mật chung giữa ta và cổng. Hai việc:
//   - HMAC: người ngoài không có khoá thì không tạo được chữ ký đúng, nên không tự "báo đã trả tiền".
//   - Mốc thời gian nằm TRONG phần được ký, và bị từ chối nếu lệch quá 5 phút: kẻ nghe lén chép lại
//     một webhook thật rồi gửi lại sau đó (replay) sẽ bị chặn.
const maxSkew = 5 * time.Minute

// Sign tạo giá trị header cho body, dùng bởi cổng giả lập (cổng thật tự ký theo cách của họ).
func Sign(secret string, at time.Time, body []byte) string {
	t := strconv.FormatInt(at.Unix(), 10)
	return fmt.Sprintf("t=%s,v1=%s", t, mac(secret, t, body))
}

func mac(secret, t string, body []byte) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(t))
	h.Write([]byte("."))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// Verify kiểm tra header chữ ký của body.
func Verify(secret string, h http.Header, body []byte, now time.Time) error {
	var t, v1 string
	for part := range strings.SplitSeq(h.Get(HeaderSignature), ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			t = v
		case "v1":
			v1 = v
		}
	}
	sec, err := strconv.ParseInt(t, 10, 64)
	if err != nil || v1 == "" {
		return ErrBadSignature
	}
	if d := now.Sub(time.Unix(sec, 0)); d > maxSkew || d < -maxSkew {
		return ErrBadSignature
	}
	// hmac.Equal so sánh trong thời gian không phụ thuộc nội dung: so bằng == thì kẻ tấn công đo
	// thời gian trả lời để đoán dần từng ký tự của chữ ký.
	if !hmac.Equal([]byte(v1), []byte(mac(secret, t, body))) {
		return ErrBadSignature
	}
	return nil
}
