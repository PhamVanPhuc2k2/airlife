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
