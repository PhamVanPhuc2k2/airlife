// Package refcode sinh mã cho người đọc: mã đơn hàng (AL-7KQ2M9XA), mã đặt chỗ (BK-…).
package refcode

import "crypto/rand"

// Bỏ 0/O, 1/I/L: khách đọc mã qua điện thoại không nhầm
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// New: prefix + 8 ký tự ngẫu nhiên (31^8 ≈ 850 tỉ mã). Cột mã có UNIQUE; trùng thì lệnh INSERT lỗi
// và khách thử lại, xác suất quá nhỏ để đáng viết vòng lặp thử lại.
func New(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read không trả lỗi (Go ≥ 1.24 dừng chương trình nếu hỏng)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return prefix + string(b)
}
