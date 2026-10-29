package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Authenticate đọc access token (cookie al_access, hoặc header "Authorization: Bearer …" cho
// app di động sau này) và gắn Actor vào context. KHÔNG chặn request: API công khai (danh sách
// phim…) vẫn chạy cho khách chưa đăng nhập. Chặn là việc của RequireAuth.
func Authenticate(tokens *TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := ""
			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				raw = strings.TrimPrefix(h, "Bearer ")
			} else if c, err := r.Cookie(accessCookie); err == nil {
				raw = c.Value
			}
			if raw == "" {
				next.ServeHTTP(w, r)
				return
			}
			actor, err := tokens.Parse(raw)
			state := authState{}
			switch {
			case err == nil:
				state.actor = &actor
			case errors.Is(err, errTokenExpired):
				state.expired = true
			}
			next.ServeHTTP(w, r.WithContext(withState(r.Context(), state)))
		})
	}
}

// RequireAuth chặn request chưa đăng nhập: 401 token_expired (frontend tự làm mới rồi thử lại)
// hoặc 401 unauthorized (chuyển tới trang đăng nhập).
func RequireAuth(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s, _ := r.Context().Value(ctxKey{}).(authState)
			switch {
			case s.actor != nil:
				next.ServeHTTP(w, r)
			case s.expired:
				response.Error(w, r, log, errTokenExpired)
			default:
				response.Error(w, r, log, errUnauthorized)
			}
		})
	}
}
