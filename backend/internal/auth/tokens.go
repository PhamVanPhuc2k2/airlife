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
