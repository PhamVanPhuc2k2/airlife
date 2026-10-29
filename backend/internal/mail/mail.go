// Package mail: các loại email của Airlife, gửi qua hàng đợi.
//
// API KHÔNG gửi mail trực tiếp: kết nối máy chủ mail có thể mất vài giây hoặc lỗi tạm thời, khách
// bấm "Đăng ký" không nên phải chờ việc đó. API chỉ đẩy một Job vào RabbitMQ (vài ms) rồi trả lời
// ngay; worker lấy job ra, dựng nội dung từ mẫu, gửi, lỗi thì thử lại (pkg/queue).
package mail

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	htmltpl "html/template"
	texttpl "text/template"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/mailer"
)

// Queue: tên hàng đợi job gửi mail.
const Queue = "email.send"

// Mẫu email có sẵn. Mỗi mẫu có <tên>.html và <tên>.txt trong templates/.
const (
	TemplateVerifyEmail   = "verify_email"
	TemplateResetPassword = "reset_password"
	TemplateOrderCreated  = "order_created"
)

// gosec G101 báo nhầm map này là "mật khẩu ghi cứng" vì có chữ "mật khẩu" trong tiêu đề email.
var subjects = map[string]string{ //nolint:gosec // xem comment trên
	TemplateVerifyEmail:   "Xác minh email tài khoản Airlife",
	TemplateResetPassword: "Đặt lại mật khẩu Airlife",
	TemplateOrderCreated:  "Airlife đã nhận đơn hàng của bạn",
}

// Job: nội dung đẩy vào hàng đợi. Chỉ chứa tên mẫu và dữ liệu, không chứa HTML: đổi giao diện
// email chỉ cần sửa mẫu và khởi động lại worker, job đang chờ trong hàng đợi cũng dùng mẫu mới.
// Data là map[string]any (không phải map[string]string) để truyền được danh sách, như các dòng của
// đơn hàng: mẫu duyệt bằng {{range .items}}.
type Job struct {
	Template string         `json:"template"`
	To       string         `json:"to"`
	Data     map[string]any `json:"data"`
}

//go:embed templates/*
var files embed.FS

// html/template tự escape dữ liệu (tên người dùng có "<script>" cũng chỉ hiện thành chữ);
// text/template cho bản chữ thường.
var (
	htmlTpl = htmltpl.Must(htmltpl.ParseFS(files, "templates/*.html"))
	textTpl = texttpl.Must(texttpl.ParseFS(files, "templates/*.txt"))
)

func render(j Job) (mailer.Message, error) {
	subject, ok := subjects[j.Template]
	if !ok {
		return mailer.Message{}, fmt.Errorf("không có mẫu email %q", j.Template)
	}
	var html, text bytes.Buffer
	if err := htmlTpl.ExecuteTemplate(&html, j.Template+".html", j.Data); err != nil {
		return mailer.Message{}, err
	}
	if err := textTpl.ExecuteTemplate(&text, j.Template+".txt", j.Data); err != nil {
		return mailer.Message{}, err
	}
	return mailer.Message{To: j.To, Subject: subject, HTML: html.String(), Text: text.String()}, nil
}

// Sender: thứ gửi được mail (mailer.SMTP; sau này thêm Resend).
type Sender interface {
	Send(ctx context.Context, m mailer.Message) error
}

// Handle trả hàm xử lý job cho queue.Consume (worker).
func Handle(sender Sender) func(ctx context.Context, body []byte) error {
	return func(ctx context.Context, body []byte) error {
		var j Job
		if err := json.Unmarshal(body, &j); err != nil {
			return fmt.Errorf("job sai định dạng: %w", err)
		}
		m, err := render(j)
		if err != nil {
			return err
		}
		return sender.Send(ctx, m)
	}
}
