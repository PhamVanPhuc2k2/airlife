# Bài 4.03: Access token JWT và refresh token xoay vòng

> [← Bài trước](02-bam-mat-khau.md) · [Mục lục](../README.md) · [Bài sau →](04-dang-ky-dang-nhap.md)

## Mục tiêu

`internal/auth/tokens.go` (cấp và kiểm tra JWT) và `internal/auth/sessions.go` (refresh token trong Redis:
cấp, xoay vòng, thu hồi, phát hiện bị đánh cắp).

## Bạn sẽ học

- Cấu trúc JWT, và vì sao phải **ghim thuật toán** khi kiểm tra.
- Xoay vòng refresh token và phát hiện tái sử dụng (reuse detection).
- Chỉ lưu **bản băm** của token.
- Xử lý trường hợp hai tab làm mới cùng lúc.

## Viết code

### Bước 1: Cài thư viện JWT

```bash
docker compose run --rm --no-deps api go get github.com/golang-jwt/jwt/v5@v5.3.1
```

Lưu ý: chạy `go mod tidy` khi chưa có file nào import thư viện thì nó bị gỡ khỏi `go.mod`. Lúc làm bài
này đã dính đúng chuyện đó: build báo `no required module provides package github.com/golang-jwt/jwt/v5`,
phải `go get` lại. Cài thư viện **sau khi** (hoặc cùng lúc) viết code dùng nó.

### Bước 2: JWT là gì

```text
eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiJlNjJjLi4uIiwicm9sZSI6InVzZXIiLCJleHAiOjE3OTN9 . 3kq9Xc…
└── header (base64) ┘   └──────────── payload (base64, AI CŨNG ĐỌC ĐƯỢC) ────────────┘   └ chữ ký ┘
```

Payload chỉ là base64, **không mã hoá**: đừng bỏ gì bí mật vào đó. An toàn nằm ở chữ ký: HMAC-SHA256
của header + payload với khoá bí mật. Sửa một ký tự payload (đổi `role: user` thành `admin`) là chữ ký
không khớp.

### Bước 3: `backend/internal/auth/tokens.go`

```go
// Package auth: đăng ký, đăng nhập, phiên đăng nhập, phân quyền.
//
// Mô hình hai token:
//   - access token: JWT ký bằng khoá bí mật, sống 15 phút. API kiểm tra chữ ký là biết ai đang
//     gọi, KHÔNG cần hỏi database hay Redis: nhanh, gọi bao nhiêu cũng được.
//   - refresh token: chuỗi ngẫu nhiên, sống 30 ngày, lưu (dạng băm) trong Redis. Chỉ dùng để
//     xin access token mới. Vì nằm trong Redis nên thu hồi được ngay (đăng xuất, bị đánh cắp).
//
// Access token bị lộ thì kẻ gian chỉ dùng được tối đa 15 phút; refresh token thì thu hồi được.
//
// Cả hai nằm trong cookie HttpOnly: JavaScript trên trang KHÔNG đọc được, nên lỗi XSS (nếu có)
// cũng không lấy cắp được token. Xem handler.go.
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

const issuer = "airlife"

var (
	errUnauthorized = apperr.Unauthorized("unauthorized", "Bạn cần đăng nhập")
	// Frontend thấy mã này thì tự gọi /auth/refresh rồi thử lại request
	errTokenExpired = apperr.Unauthorized("token_expired", "Phiên đăng nhập đã hết hạn")
)

// Actor: người đang gọi API, lấy từ access token.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

type claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

type TokenIssuer struct {
	secret []byte
	ttl    time.Duration
}

func NewTokenIssuer(secret string, ttl time.Duration) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret), ttl: ttl}
}

func (t *TokenIssuer) Issue(userID uuid.UUID, role string) (string, error) {
	now := time.Now()
	c := claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(t.secret)
}

func (t *TokenIssuer) Parse(token string) (Actor, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c,
		func(*jwt.Token) (any, error) { return t.secret, nil },
		// Chỉ chấp nhận HS256. Không ghim thuật toán thì kẻ gian gửi token "alg: none" (không
		// chữ ký) hoặc đổi thuật toán để lừa thư viện bỏ qua bước kiểm tra chữ ký.
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithExpirationRequired(),
	)
	if errors.Is(err, jwt.ErrTokenExpired) {
		return Actor{}, errTokenExpired
	}
	if err != nil {
		return Actor{}, errUnauthorized
	}
	id, err := uuid.Parse(c.Subject)
	if err != nil {
		return Actor{}, errUnauthorized
	}
	return Actor{UserID: id, Role: c.Role}, nil
}

// --- Actor trong context ---

type ctxKey struct{}

type authState struct {
	actor   *Actor
	expired bool // có gửi access token nhưng đã hết hạn
}

func withState(ctx context.Context, s authState) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// ActorFrom trả người đang gọi API; ok = false nếu chưa đăng nhập.
func ActorFrom(ctx context.Context) (Actor, bool) {
	s, _ := ctx.Value(ctxKey{}).(authState)
	if s.actor == nil {
		return Actor{}, false
	}
	return *s.actor, true
}
```

- **`jwt.WithValidMethods([]string{"HS256"})`**: header JWT tự khai báo thuật toán (`alg`). Kẻ gian gửi
  `"alg": "none"` (không chữ ký); thư viện nào tin vào header là bỏ qua kiểm tra chữ ký. Ghim thuật toán
  thì token như vậy bị từ chối. Bài 4.05 thử đúng tấn công này.
- **`errTokenExpired` tách riêng khỏi `errUnauthorized`**: hết hạn thì frontend tự làm mới; sai chữ ký
  thì không.
- **`authState.expired`**: middleware nhớ "có gửi token nhưng hết hạn", để API cần đăng nhập trả đúng
  `token_expired` (bài 4.05).

### Bước 4: `backend/internal/auth/sessions.go`

```go
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

// Refresh token lưu trong Redis, XOAY VÒNG: mỗi lần dùng để xin access token mới thì token cũ
// bị huỷ và cấp token mới. Các token nối tiếp nhau từ một lần đăng nhập thuộc cùng một "họ"
// (family).
//
// Phát hiện bị đánh cắp: token cũ đã đổi rồi mà vẫn có người gửi lên, nghĩa là có HAI bên đang
// giữ token này (người dùng và kẻ gian). Không biết bên nào thật, nên thu hồi cả họ: cả hai
// cùng phải đăng nhập lại, và kẻ gian mất quyền truy cập.
//
// Khoá Redis:
//   auth:rt:<băm token>      → "<user_id>|<family>"     token còn hiệu lực
//   auth:fam:<family>        → tập các băm token của họ   để thu hồi cả họ
//   auth:used:<băm token>    → "<family>|<unix>"         token đã đổi, nhớ lại để bắt tái sử dụng
//
// Chỉ lưu BẢN BĂM sha256 của token: ai đọc được Redis cũng không có token để dùng.

var (
	errRefreshInvalid = apperr.Unauthorized("refresh_invalid", "Phiên đăng nhập không còn hiệu lực")
	errSessionRevoked = apperr.Unauthorized("session_revoked", "Phiên đăng nhập đã bị thu hồi vì lý do an toàn")
	// Hai tab cùng làm mới gần như một lúc: tab sau gửi token tab trước vừa đổi. Không phải bị
	// đánh cắp; frontend thử lại request (cookie đã là token mới do tab kia nhận về).
	errRefreshRace = apperr.Unauthorized("refresh_race", "Phiên vừa được làm mới, vui lòng thử lại")
)

// Khoảng thời gian coi việc gửi lại token vừa đổi là "hai tab tranh nhau", không phải đánh cắp.
const raceGrace = 10 * time.Second

type Sessions struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewSessions(rdb *redis.Client, ttl time.Duration) *Sessions {
	return &Sessions{rdb: rdb, ttl: ttl}
}

// Create mở phiên mới (đăng nhập, đăng ký), trả refresh token gốc để đặt vào cookie.
func (s *Sessions) Create(ctx context.Context, userID uuid.UUID) (string, error) {
	return s.issue(ctx, userID, uuid.NewString())
}

// Rotate đổi refresh token cũ lấy token mới. Trả user_id của phiên.
func (s *Sessions) Rotate(ctx context.Context, old string) (uuid.UUID, string, error) {
	h := hashToken(old)
	// GETDEL: lấy và xoá trong một lệnh. Hai request cùng gửi một token thì chỉ MỘT request
	// lấy được, request kia rơi vào nhánh "đã dùng" bên dưới.
	val, err := s.rdb.GetDel(ctx, "auth:rt:"+h).Result()
	if errors.Is(err, redis.Nil) {
		return uuid.Nil, "", s.checkReuse(ctx, h)
	}
	if err != nil {
		return uuid.Nil, "", err
	}
	userID, family, err := splitSession(val)
	if err != nil {
		return uuid.Nil, "", err
	}
	newToken, err := s.issue(ctx, userID, family)
	if err != nil {
		return uuid.Nil, "", err
	}
	pipe := s.rdb.TxPipeline()
	pipe.SRem(ctx, "auth:fam:"+family, h)
	pipe.Set(ctx, "auth:used:"+h, family+"|"+strconv.FormatInt(time.Now().Unix(), 10), s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return uuid.Nil, "", err
	}
	return userID, newToken, nil
}

// Revoke: đăng xuất, thu hồi cả họ token của phiên này.
func (s *Sessions) Revoke(ctx context.Context, token string) error {
	val, err := s.rdb.GetDel(ctx, "auth:rt:"+hashToken(token)).Result()
	if errors.Is(err, redis.Nil) {
		return nil // đã hết hạn hoặc đã đăng xuất: coi như xong
	}
	if err != nil {
		return err
	}
	_, family, err := splitSession(val)
	if err != nil {
		return err
	}
	return s.revokeFamily(ctx, family)
}

func (s *Sessions) issue(ctx context.Context, userID uuid.UUID, family string) (string, error) {
	b := make([]byte, 32) // 256 bit ngẫu nhiên: không thể đoán
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	h := hashToken(token)
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, "auth:rt:"+h, userID.String()+"|"+family, s.ttl)
	pipe.SAdd(ctx, "auth:fam:"+family, h)
	pipe.Expire(ctx, "auth:fam:"+family, s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Sessions) checkReuse(ctx context.Context, h string) error {
	used, err := s.rdb.Get(ctx, "auth:used:"+h).Result()
	if errors.Is(err, redis.Nil) {
		return errRefreshInvalid // token lạ hoặc đã hết hạn
	}
	if err != nil {
		return err
	}
	family, at, _ := strings.Cut(used, "|")
	unix, _ := strconv.ParseInt(at, 10, 64)
	if time.Since(time.Unix(unix, 0)) < raceGrace {
		return errRefreshRace
	}
	if err := s.revokeFamily(ctx, family); err != nil {
		return err
	}
	return errSessionRevoked
}

func (s *Sessions) revokeFamily(ctx context.Context, family string) error {
	hashes, err := s.rdb.SMembers(ctx, "auth:fam:"+family).Result()
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(hashes)+1)
	for _, h := range hashes {
		keys = append(keys, "auth:rt:"+h)
	}
	keys = append(keys, "auth:fam:"+family)
	return s.rdb.Del(ctx, keys...).Err()
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func splitSession(val string) (uuid.UUID, string, error) {
	idStr, family, ok := strings.Cut(val, "|")
	id, err := uuid.Parse(idStr)
	if !ok || err != nil {
		return uuid.Nil, "", fmt.Errorf("phiên trong Redis sai định dạng: %q", val)
	}
	return id, family, nil
}
```

Ví dụ một phiên:

```text
Đăng nhập        → token A (họ F)          Redis: rt:A, fam:F={A}
Làm mới bằng A   → A bị xoá, cấp token B   Redis: rt:B, fam:F={B}, used:A="F|<giờ>"
Kẻ gian dùng A   → rt:A không còn, used:A có → thu hồi họ F: xoá rt:B, fam:F
Người dùng thật dùng B → rt:B không còn → refresh_invalid → phải đăng nhập lại (kẻ gian cũng vậy)
```

- **`GetDel`**: lấy và xoá cùng lúc; hai request cùng gửi một token thì chỉ một request thắng.
- **`raceGrace` 10 giây**: người dùng mở hai tab, cả hai cùng hết hạn và cùng làm mới. Tab 1 đổi A
  thành B, tab 2 gửi A ngay sau đó. Không có khoảng ân hạn thì tab 2 bị coi là kẻ gian, và người dùng bị
  đăng xuất vô cớ. Trong 10 giây thì trả `refresh_race`: frontend thử lại (cookie lúc này đã là B).
- **`TxPipeline`**: gửi nhiều lệnh Redis trong một lần, chạy liền nhau như một khối (MULTI/EXEC).

## Kiểm tra

```bash
cd backend && go build ./... && go vet ./internal/auth && cd ..
```

Thử thật ở bài 4.05.

```bash
git add . && git commit -m "Access token JWT, refresh token xoay vòng"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Mọi token đều báo `unauthorized` | Khoá ký và khoá kiểm tra khác nhau (đổi `AUTH_JWT_SECRET` thì mọi token cũ mất hiệu lực, đúng như mong đợi) |
| Người dùng hay bị đăng xuất vô cớ | Thiếu khoảng ân hạn `raceGrace`, hoặc frontend gọi refresh nhiều lần song song (bài 4.06) |
