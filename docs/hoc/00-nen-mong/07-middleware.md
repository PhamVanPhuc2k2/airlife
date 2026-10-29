# Bài 0.07: Middleware: IP thật sau Cloudflare, log request, bắt panic

> [← Bài trước](06-ket-noi-ha-tang.md) · [Mục lục](../README.md) · [Bài sau →](08-router-va-health.md)

## Mục tiêu

Ba middleware tự viết trong `internal/server/middleware.go`:
- `realIP`: lấy IP thật của khách khi API đứng sau Cloudflare + nginx.
- `requestLogger`: mỗi request một dòng log có `request_id`.
- `recoverer`: handler panic thì trả 500 JSON, server vẫn chạy.

## Bạn sẽ học

- Middleware là hàm `func(http.Handler) http.Handler`: bọc handler, làm gì đó trước và/hoặc sau nó.
- **Header do client gửi lên thì không tin được.** Chỉ tin header IP khi request đến từ proxy của mình.
- Truyền dữ liệu giữa middleware và handler bằng `context.WithValue` với khoá có kiểu riêng.

## Viết code

### Vì sao cần `realIP`

Production: `khách → Cloudflare → nginx → API`. API chỉ thấy `r.RemoteAddr` là IP của nginx.
Nếu rate limit theo IP đó thì **mọi khách** chung một bộ đếm, một người spam là tất cả bị chặn.

Cloudflare gửi IP thật trong header `CF-Connecting-IP`. Nhưng header thì ai cũng tự đặt được:

```bash
curl -H "CF-Connecting-IP: 1.2.3.4" https://api.airlife.vn/...
```

Nếu tin header vô điều kiện, kẻ gian đổi IP mỗi request để né rate limit. Nên chỉ tin khi
`RemoteAddr` nằm trong `HTTP_TRUSTED_PROXIES` (IP của nginx). Middleware `RealIP` có sẵn
của chi tin vô điều kiện, nên ta tự viết.

### `internal/server/middleware.go`

```go
package server

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
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
```

Điểm chính:

- **`type ctxKey int`**: khoá context dùng kiểu riêng của gói, không dùng `string`. Gói khác
  vô tình dùng cùng chuỗi `"client_ip"` cũng không đè được giá trị của ta.
- **`netip`** (thư viện chuẩn): so IP với dải mạng (`127.0.0.1/32`) bằng `Prefix.Contains`.
- **`ip.Unmap()`**: server nghe cả IPv4 lẫn IPv6 có thể nhận địa chỉ dạng `::ffff:127.0.0.1`.
  Không bỏ tiền tố này thì so với `127.0.0.1/32` sẽ ra sai.
- **`middleware.NewWrapResponseWriter`**: `http.ResponseWriter` không cho đọc lại mã trạng thái
  đã ghi; bọc lại để logger biết status và số byte.
- **`recoverer`** in `debug.Stack()` để biết panic ở dòng nào, còn client chỉ nhận lỗi chung.
  `http.ErrAbortHandler` là panic **có chủ đích** của net/http để huỷ request, nên ném lại, không coi là lỗi.
  Dòng `//nolint:errorlint` tắt cảnh báo của linter ở đúng chỗ đó, kèm lý do: `rec` là giá
  trị panic chứ không phải lỗi bị bọc, nên so bằng `==` là đúng.

## Kiểm tra

```bash
cd backend && go build ./... && go vet ./...
```

Bài 0.10 chạy api trong Docker, thấy dòng log `msg=http` với `request_id` và `ip`, và thử
gửi header IP giả để xem `realIP` bỏ qua nó thế nào.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Log luôn ghi IP của nginx | Thiếu IP của nginx trong `HTTP_TRUSTED_PROXIES`. Trong mạng Docker thường là dải `172.16.0.0/12` |
| Status trong log luôn là 0 | Handler không gọi `WriteHeader`; Go ngầm dùng 200. Code đã đổi 0 thành 200 |
