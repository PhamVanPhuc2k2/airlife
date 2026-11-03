// Package money: định dạng tiền Việt Nam. Tiền luôn là số nguyên, đơn vị đồng (xem bài 7.01).
package money

import (
	"strconv"
	"strings"
)

// FormatVND: 389000 → "389.000₫"
func FormatVND(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return b.String() + "₫"
}
