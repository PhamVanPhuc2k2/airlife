# Bài 11.04: Góp ý và Cloudflare Turnstile

> [← Bài trước](03-khao-sat.md) · [Mục lục](../README.md) · [Bài sau →](05-thu-api.md)

## Mục tiêu

Nhận góp ý từ cả khách chưa đăng nhập, chặn bot bằng Cloudflare Turnstile ở phía server, và chặn người gửi dồn dập bằng giới hạn tốc độ.

## Bạn sẽ học

- Turnstile hoạt động thế nào: widget ở trình duyệt cấp token một lần, **server** mới là nơi xác minh.
- Viết client `siteverify` và middleware chi dùng lại cho mọi form công khai sau này (Liên hệ, đăng ký).
- Vì sao "Cloudflare không trả lời" phải **từ chối** chứ không cho qua.
- Cấu hình khoá: khoá thử cho dev, khoá thật bắt buộc ở production.
- Header tuỳ biến phải khai báo trong CORS.

## Viết code

### Bước 1: Client xác minh, `backend/pkg/turnstile/turnstile.go`

```go
// Package turnstile xác minh token Cloudflare Turnstile (CAPTCHA không cần giải đố) ở server.
//
// Trình duyệt chạy widget Turnstile và nhận một token dùng một lần; API gửi token đó cùng khoá
// bí mật tới siteverify của Cloudflare để biết có phải người thật không. Token chỉ có giá trị khi
// server xác minh: kiểm tra ở frontend thôi thì bot gọi thẳng API là qua.
package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Khoá thử CÔNG KHAI của Cloudflare để dev: secret này luôn cho qua. Không dùng ở production.
const (
	TestSecretPass = "1x0000000000000000000000000000000AA"
	TestSecretFail = "2x0000000000000000000000000000000AA"
)

// ErrRejected: Cloudflare nói token sai, hết hạn hoặc đã dùng. Khác với lỗi mạng.
var ErrRejected = errors.New("turnstile: token bị từ chối")

type Verifier struct {
	secret string
	url    string
	http   *http.Client
}

func NewVerifier(secret, verifyURL string) *Verifier {
	if verifyURL == "" {
		verifyURL = DefaultVerifyURL
	}
	return &Verifier{secret: secret, url: verifyURL, http: &http.Client{Timeout: 5 * time.Second}}
}

type response struct {
	Success    bool     `json:"success"`
	ErrorCodes []string `json:"error-codes"`
}

// Verify trả nil nếu token hợp lệ, ErrRejected nếu Cloudflare từ chối, lỗi khác nếu không hỏi được.
// remoteIP không bắt buộc nhưng giúp Cloudflare đối chiếu.
func (v *Verifier) Verify(ctx context.Context, token, remoteIP string) error {
	if strings.TrimSpace(token) == "" {
		return ErrRejected
	}
	form := url.Values{"secret": {v.secret}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.url, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := v.http.Do(req)
	if err != nil {
		return fmt.Errorf("turnstile: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("turnstile: siteverify trả %d", resp.StatusCode)
	}
	var out response
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil {
		return fmt.Errorf("turnstile: đọc phản hồi: %w", err)
	}
	if !out.Success {
		return fmt.Errorf("%w (%s)", ErrRejected, strings.Join(out.ErrorCodes, ","))
	}
	return nil
}
```

- Ba kết cục: `nil` (hợp lệ), `ErrRejected` (Cloudflare nói sai/hết hạn/đã dùng), lỗi khác (không hỏi được: mạng, timeout, 5xx).
- Token rỗng bị từ chối ngay, không tốn một lần gọi mạng.
- `io.LimitReader` giới hạn phản hồi 64 KB; timeout 5 giây.
- Hai khoá thử công khai của Cloudflare: `1x00000…AA` luôn cho qua, `2x00000…AA` luôn từ chối. Dùng để thử cả hai nhánh.

### Bước 2: Middleware, `backend/internal/server/middleware.go`

```go
package server

import (
	"context"
	"errors"
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
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/turnstile"
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

// requireTurnstile chặn request không kèm token Turnstile hợp lệ. Token nằm trong header
// X-Turnstile-Token (không để trong body để mọi form dùng chung một middleware).
// Không hỏi được Cloudflare thì từ chối (503) thay vì cho qua: lỗ hổng "Cloudflare sập là bot
// vào hết" nguy hiểm hơn việc form tạm thời không gửi được.
func requireTurnstile(v *turnstile.Verifier, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			err := v.Verify(r.Context(), r.Header.Get("X-Turnstile-Token"), ClientIP(r.Context()))
			switch {
			case err == nil:
				next.ServeHTTP(w, r)
			case errors.Is(err, turnstile.ErrRejected):
				response.Error(w, r, log, apperr.Invalid("captcha_failed", "Xác minh chống spam chưa thành công, vui lòng thử lại"))
			default:
				response.Error(w, r, log, apperr.Unavailable("captcha_unavailable", "Không xác minh được lúc này, vui lòng thử lại sau").WithErr(err))
			}
		})
	}
}
```

Token đi trong header `X-Turnstile-Token`, không để trong JSON body: nhờ vậy mọi form dùng chung một middleware mà không phải đổi định dạng body.
Lỗi mạng trả 503 `captcha_unavailable` (**fail closed**): nếu cho qua khi Cloudflare chập chờn thì kẻ gian chỉ cần chờ lúc đó.

### Bước 3: Cấu hình, `backend/internal/config/config.go`

Thêm nhóm `Captcha` với `TURNSTILE_SECRET` (mặc định là khoá thử, dev chạy ngay) và `TURNSTILE_VERIFY_URL`. Trong `validate()`:

```go
if c.IsProduction() && (c.Captcha.TurnstileSecret == "" || strings.HasPrefix(c.Captcha.TurnstileSecret, "1x0000")) {
    return errors.New("TURNSTILE_SECRET production phải là khoá thật, không dùng khoá thử của Cloudflare")
}
```

Quên đặt khoá thật khi lên production thì API **không khởi động** thay vì chạy với CAPTCHA vô hiệu.

### Bước 4: Góp ý, `backend/internal/opinion/opinion.go` (hàm `Feedback`)

- Ô nào sai báo đúng ô đó (`topic`, `rating`, `body`, `flight_code`, `email`). Email kiểm bằng `net/mail.ParseAddress` rồi **so lại** `a.Address == in.Email` (nếu không, `Tên <a@b.vn>` cũng lọt).
- Số hiệu chuyến bay: chữ hoa, khớp `^[A-Z0-9]{2}\s?[0-9]{1,4}$`.
- Giới hạn **5 góp ý/giờ/IP** bằng Redis. Turnstile chặn bot; giới hạn này chặn người thật gửi dồn dập. IP lấy từ `ClientIP` (đã xử lý proxy tin cậy ở Phần 0).
- `viewer(r)` có thể `nil`: khách vãng lai ghi `user_id = NULL`.

### Bước 5: Route và CORS, `backend/internal/server/server.go`

```go
r.With(turnstileMW).Post("/feedback", opinionH.Feedback)
```

Và thêm `X-Turnstile-Token` vào `AllowedHeaders` của CORS. Thiếu dòng này thì **curl vẫn chạy** nhưng trình duyệt bị chặn ở bước preflight (xem phần lỗi bên dưới).

## Kiểm tra

Xem bài 11.05 (ba tình huống: không token, khoá luôn cho qua, khoá luôn từ chối, mất kết nối).

## Hay gặp lỗi

- **Form góp ý bấm gửi không có phản hồi gì, console báo CORS/`Failed to fetch`, nhưng curl thì 204.** Header `X-Turnstile-Token` chưa có trong `AllowedHeaders`: trình duyệt gửi `OPTIONS` hỏi trước, server không liệt kê header đó nên chặn. Curl không làm preflight nên không gặp.
- **Token "đã dùng" ở lần gửi thứ hai** (`timeout-or-duplicate`): token chỉ dùng một lần. Frontend phải `reset()` widget sau **mỗi** lần gửi, kể cả khi lỗi (bài 11.06).
- **Production khởi động rồi dừng với "TURNSTILE_SECRET production phải là khoá thật"**: đúng ý muốn. Tạo widget ở dash.cloudflare.com → Turnstile, đặt secret thật bằng biến môi trường.
