// Package password băm và kiểm tra mật khẩu bằng argon2id.
//
// Vì sao argon2id (không phải md5, sha256, hay bcrypt):
//   - md5/sha256 được thiết kế để NHANH: card đồ hoạ thử hàng tỉ mật khẩu mỗi giây.
//   - argon2id được thiết kế để CHẬM và TỐN BỘ NHỚ có chủ đích: mỗi lần thử tốn ~19 MB RAM,
//     nên dò hàng loạt bằng card đồ hoạ trở nên rất đắt. Thắng cuộc thi Password Hashing
//     Competition, là lựa chọn đầu tiên OWASP khuyên dùng.
//   - bcrypt vẫn ổn nhưng chỉ dùng 72 byte đầu của mật khẩu và không tốn bộ nhớ.
//
// Tham số theo khuyến nghị tối thiểu của OWASP (Password Storage Cheat Sheet):
// m = 19 MiB, t = 2 vòng, p = 1 luồng.
package password

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	memoryKiB   = 19 * 1024
	iterations  = 2
	parallelism = 1
	saltLen     = 16
	keyLen      = 32
)

var errMalformed = errors.New("password: chuỗi băm sai định dạng")

// Hash trả chuỗi dạng PHC: $argon2id$v=19$m=19456,t=2,p=1$<muối base64>$<mã băm base64>.
// Tham số và muối nằm ngay trong chuỗi, nên sau này tăng tham số thì mật khẩu cũ vẫn kiểm tra được.
func Hash(plain string) (string, error) {
	// Muối ngẫu nhiên riêng cho từng mật khẩu: hai người cùng mật khẩu "123456" có mã băm khác
	// nhau, và kẻ gian không dùng được bảng mã băm tính sẵn (rainbow table).
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(plain), salt, iterations, memoryKiB, parallelism, keyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memoryKiB, iterations, parallelism, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// Verify kiểm tra mật khẩu với chuỗi băm đã lưu.
func Verify(plain, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// "", "argon2id", "v=19", "m=…,t=…,p=…", muối, mã băm
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errMalformed
	}
	var m uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, errMalformed
	}
	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return false, errMalformed
	}
	want, err := b64.DecodeString(parts[5])
	if err != nil {
		return false, errMalformed
	}
	got := argon2.IDKey([]byte(plain), salt, t, m, p, uint32(len(want))) //nolint:gosec // độ dài mã băm 32 byte
	// So sánh thời gian cố định: dùng == thì so tới byte sai đầu tiên là dừng, kẻ gian đo thời
	// phản hồi có thể đoán dần mã băm (timing attack).
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
