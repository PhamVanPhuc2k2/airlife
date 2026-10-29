package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Ba cookie:
//
//	al_access  access token (JWT). Path=/ : mọi request tới API đều gửi kèm.
//	al_refresh refresh token. Path=/api/v1/auth : trình duyệt CHỈ gửi kèm khi gọi API đăng nhập
//	           (refresh, logout); token sống lâu này không đi theo hàng trăm request khác.
//	al_session "1", KHÔNG HttpOnly: chỉ là dấu hiệu "đang có phiên" để frontend (và proxy của
//	           Next.js) biết mà không cần gọi API. Không chứa bí mật gì.
//
// HttpOnly: JavaScript không đọc được → lỗi XSS cũng không lấy được token.
// SameSite=Lax: trình duyệt không gửi cookie khi trang web KHÁC gửi form POST sang API → chặn
// phần lớn tấn công CSRF (thêm lớp kiểm tra Origin ở internal/server/middleware.go).
// Secure: chỉ gửi qua HTTPS. Tắt khi dev (http://localhost).
const (
	accessCookie  = "al_access"
	refreshCookie = "al_refresh"
	sessionCookie = "al_session"
	refreshPath   = "/api/v1/auth"
)

type CookieConfig struct {
	Domain     string
	Secure     bool
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

type Handler struct {
	svc      *Service
	log      *slog.Logger
	cookies  CookieConfig
	clientIP func(*http.Request) string
}

func NewHandler(svc *Service, log *slog.Logger, cookies CookieConfig, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, cookies: cookies, clientIP: clientIP}
}

// POST /api/v1/auth/register {email, password, display_name}
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var in RegisterInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Register(r.Context(), in, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.Created(w, sess.User)
}

// POST /api/v1/auth/login {email, password}
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Login(r.Context(), in.Email, in.Password, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/refresh — đọc cookie al_refresh, đặt cặp cookie mới
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		h.clearSession(w)
		response.Error(w, r, h.log, errRefreshInvalid)
		return
	}
	sess, err := h.svc.Refresh(r.Context(), c.Value)
	if err != nil {
		// refresh_race: KHÔNG xoá cookie, vì tab kia vừa đặt cookie mới hợp lệ
		if !errors.Is(err, errRefreshRace) {
			h.clearSession(w)
		}
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		if err := h.svc.Logout(r.Context(), c.Value); err != nil {
			response.Error(w, r, h.log, err)
			return
		}
	}
	h.clearSession(w)
	response.NoContent(w)
}

// POST /api/v1/auth/verify-email {token} — bấm link trong email
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), in.Token); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/verify-email/resend — cần đăng nhập
func (h *Handler) ResendVerifyEmail(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFrom(r.Context())
	if err := h.svc.ResendVerifyEmail(r.Context(), actor.UserID); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/forgot-password {email} — luôn 204, kể cả khi email không có tài khoản
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.ForgotPassword(r.Context(), in.Email, h.clientIP(r)); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/reset-password {token, password}
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.ResetPassword(r.Context(), in.Token, in.Password); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	// Mọi phiên đã bị thu hồi; xoá luôn cookie của trình duyệt này (nếu có)
	h.clearSession(w)
	response.NoContent(w)
}

// GET /api/v1/auth/me — cần đăng nhập (RequireAuth)
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFrom(r.Context())
	u, err := h.svc.Me(r.Context(), actor.UserID)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, u)
}

func (h *Handler) setSession(w http.ResponseWriter, s Session) {
	h.cookie(w, accessCookie, s.AccessToken, "/", h.cookies.AccessTTL, true)
	h.cookie(w, refreshCookie, s.RefreshToken, refreshPath, h.cookies.RefreshTTL, true)
	h.cookie(w, sessionCookie, "1", "/", h.cookies.RefreshTTL, false)
}

func (h *Handler) clearSession(w http.ResponseWriter) {
	// MaxAge âm = xoá cookie ngay. Path, Domain phải giống lúc đặt thì trình duyệt mới xoá đúng cookie.
	h.cookie(w, accessCookie, "", "/", -1, true)
	h.cookie(w, refreshCookie, "", refreshPath, -1, true)
	h.cookie(w, sessionCookie, "", "/", -1, false)
}

func (h *Handler) cookie(w http.ResponseWriter, name, value, path string, ttl time.Duration, httpOnly bool) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	// Secure/HttpOnly là biến có chủ đích: al_session cố ý không HttpOnly (chỉ là dấu hiệu, không
	// chứa bí mật), Secure chỉ tắt khi dev. Xem comment đầu file.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: xem comment ngay trên
		Name:     name,
		Value:    value,
		Path:     path,
		Domain:   h.cookies.Domain,
		MaxAge:   maxAge,
		HttpOnly: httpOnly,
		Secure:   h.cookies.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}
