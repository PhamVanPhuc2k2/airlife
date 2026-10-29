# Bài 4.02: Băm mật khẩu bằng argon2id, đọc JSON an toàn

> [← Bài trước](01-tong-quan-va-schema.md) · [Mục lục](../README.md) · [Bài sau →](03-access-va-refresh-token.md)

## Mục tiêu

`pkg/password` (băm và kiểm tra mật khẩu) và `pkg/request` (đọc body JSON có giới hạn).

## Bạn sẽ học

- Băm mật khẩu khác băm thông thường thế nào: **chậm có chủ đích**, có muối.
- Định dạng PHC: tham số nằm ngay trong chuỗi băm.
- So sánh thời gian cố định (`subtle.ConstantTimeCompare`).
- Đọc cảnh báo cấp module của govulncheck.

## Viết code

### Bước 1: Cài thư viện

```bash
docker compose run --rm --no-deps api go get golang.org/x/crypto@v0.58.0
```

### Bước 2: `backend/pkg/password/argon2.go`

```go
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
```

Chuỗi băm lưu vào `users.password_hash` có dạng:

```text
$argon2id$v=19$m=19456,t=2,p=1$<16 byte muối, base64>$<32 byte mã băm, base64>
```

Đọc lại chuỗi là biết dùng tham số nào. Vài năm nữa máy mạnh hơn, tăng `iterations` cho mật khẩu mới;
mật khẩu cũ vẫn kiểm tra đúng bằng tham số cũ ghi trong chuỗi của nó.

### Bước 3: `backend/pkg/request/json.go`

```go
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
```

- **`MaxBytesReader`**: không giới hạn thì một request gửi body 2 GB làm API hết bộ nhớ.
- **`DisallowUnknownFields`**: frontend gửi `displayName` (sai tên) thay vì `display_name` thì báo lỗi
  ngay, không lặng lẽ bỏ qua rồi đi tìm lỗi "sao tên hiển thị rỗng".

### Bước 4: Cảnh báo của govulncheck

```bash
make vuln
```

```text
Your code is affected by 0 vulnerabilities.
This scan also found 0 vulnerabilities in packages you import and 1
vulnerability in modules you require, but your code doesn't appear to call these
vulnerabilities.
```

Xem chi tiết: `docker compose run --rm --no-deps api go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 -show verbose ./...`

```text
Vulnerability #1: GO-2026-5932
    The golang.org/x/crypto/openpgp package is unmaintained, unsafe by design, …
```

Lỗ hổng nằm ở gói `openpgp` trong module `x/crypto`; dự án chỉ dùng gói `argon2`. govulncheck phân tích
**đường gọi hàm** nên phân biệt được "module có lỗ hổng" với "code của mình gọi tới chỗ lỗ hổng". Ở đây
không gọi, không cần làm gì; khi nào thêm import mới thì chạy lại `make vuln`.

## Kiểm tra

```bash
cd backend && go build ./... && cd ..
make lint
git add . && git commit -m "Băm mật khẩu argon2id, đọc JSON có giới hạn"
```

Thử băm (thư mục `_thu` bị `go build ./...` bỏ qua, xem bài 3.01):

```bash
mkdir -p backend/cmd/_thu && cat > backend/cmd/_thu/main.go <<'EOF'
package main

import (
	"fmt"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/password"
)

func main() {
	h1, _ := password.Hash("123456")
	h2, _ := password.Hash("123456")
	fmt.Println(h1)
	fmt.Println(h2) // khác h1: muối khác nhau
	ok, _ := password.Verify("123456", h1)
	bad, _ := password.Verify("1234567", h1)
	fmt.Println(ok, bad) // true false
}
EOF
docker compose run --rm --no-deps api go run ./cmd/_thu
rm -rf backend/cmd/_thu
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đăng nhập chậm vài trăm ms | argon2 cố ý chậm (~50 ms một lần). Chậm hơn nhiều thì máy thiếu CPU/RAM; đừng giảm tham số dưới mức OWASP |
| `password: chuỗi băm sai định dạng` | Cột `password_hash` bị ghi tay bằng mật khẩu gốc hoặc chuỗi khác định dạng PHC |
