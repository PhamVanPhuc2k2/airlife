package server

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	"slices"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type ctxKey int

const clientIPKey ctxKey = iota

// ClientIP trả IP thật của khách (đã qua middleware realIP). Dùng cho rate limit, log.
func ClientIP(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey).(string)
	return ip
}

// realIP xác định IP thật của khách.
//
// Production: khách → Cloudflare → nginx → API. Nếu chỉ đọc r.RemoteAddr thì mọi
// request đều mang IP của nginx, rate limit sẽ chặn tất cả mọi người cùng lúc.
//
// Nhưng header thì ai cũng tự đặt được: kẻ gian gửi thẳng "CF-Connecting-IP: 1.2.3.4"
// là đổi được IP để né rate limit. Vì vậy chỉ tin header khi request đi tới từ một
// proxy nằm trong HTTP_TRUSTED_PROXIES; còn lại dùng RemoteAddr.
//
// chi có sẵn middleware.RealIP nhưng nó tin header vô điều kiện, nên tự viết.
func realIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := remoteIP(r.RemoteAddr)
			if isTrusted(ip, trusted) {
				for _, h := range []string{"CF-Connecting-IP", "X-Real-IP"} {
					if v, err := netip.ParseAddr(r.Header.Get(h)); err == nil {
						ip = v
						break
					}
				}
			}
			ctx := context.WithValue(r.Context(), clientIPKey, ip.String())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func remoteIP(remoteAddr string) netip.Addr {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip, _ := netip.ParseAddr(host)
	return ip.Unmap() // "::ffff:127.0.0.1" → "127.0.0.1" để so được với prefix IPv4
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// requestLogger ghi một dòng log cho mỗi request, kèm request_id để lần theo lỗi:
// frontend báo "request_id=abc" → tìm đúng dòng log đó.
func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK // handler không gọi WriteHeader
			}
			// Docker gọi /healthz 5 giây một lần; ghi log hết thì log toàn dòng healthz.
			if r.URL.Path == "/healthz" && status < 500 {
				return
			}
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			}
			log.Log(r.Context(), level, "http",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"bytes", ww.BytesWritten(),
				"duration_ms", time.Since(start).Milliseconds(),
				"ip", ClientIP(r.Context()),
			)
		})
	}
}

// recoverer bắt panic trong handler: ghi log kèm stack trace, trả 500 dạng JSON
// đúng khuôn của API, và giữ cho server tiếp tục chạy.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// http.ErrAbortHandler là cách net/http chủ động huỷ request, không phải lỗi.
				//nolint:errorlint // rec là giá trị panic (any), không phải lỗi bị bọc; net/http panic đúng giá trị này
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				log.ErrorContext(r.Context(), "panic",
					"panic", rec,
					"request_id", middleware.GetReqID(r.Context()),
					"stack", string(debug.Stack()),
				)
				response.Error(w, r, log, apperr.Internal(nil))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// sameOrigin chống CSRF cho request làm thay đổi dữ liệu (POST, PUT, PATCH, DELETE).
//
// CSRF: khách đang đăng nhập Airlife, mở một trang web xấu; trang đó lén gửi form POST tới API
// Airlife. Trình duyệt tự gửi kèm cookie đăng nhập, API tưởng chính khách thao tác.
// Cookie SameSite=Lax đã chặn phần lớn trường hợp; lớp này chặn tiếp: trình duyệt luôn gửi
// header Origin (trang gốc của request) với request POST, và trang web xấu không giả được header
// này. Origin không nằm trong danh sách domain của mình → từ chối.
//
// Không có Origin (curl, server Next.js gọi từ trong mạng Docker) thì cho qua: không phải trình
// duyệt nên không có cookie của khách để lợi dụng.
func sameOrigin(allowed []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !slices.Contains(allowed, origin) {
				response.Error(w, r, slog.Default(),
					apperr.Forbidden("origin_not_allowed", "Yêu cầu bị từ chối"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
