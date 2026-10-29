// Package mailer gửi email qua SMTP.
//
// Dev: SMTP của Mailpit (không mã hoá, không đăng nhập), thư không đi đâu cả, xem ở
// http://localhost:8025. Production sẽ thêm bản gửi qua API của Resend (TASKS.md: email dùng Resend).
package mailer

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"time"
)

type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string // bản chữ thường cho ứng dụng mail không hiện HTML
}

type SMTP struct {
	addr string
	from *mail.Address
}

func NewSMTP(addr, from string) (*SMTP, error) {
	f, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("MAIL_FROM không hợp lệ: %w", err)
	}
	return &SMTP{addr: addr, from: f}, nil
}

func (s *SMTP) Send(ctx context.Context, m Message) error {
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("địa chỉ nhận không hợp lệ: %w", err)
	}
	raw, err := s.build(to, m)
	if err != nil {
		return err
	}

	// smtp.SendMail không nhận context, không có thời hạn: máy chủ mail treo là worker treo theo.
	// Tự kết nối bằng Dialer có timeout và gắn hạn chót cho cả phiên.
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return fmt.Errorf("kết nối SMTP: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	host, _, _ := net.SplitHostPort(s.addr)
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer func() { _ = c.Close() }()

	if err := c.Mail(s.from.Address); err != nil {
		return err
	}
	if err := c.Rcpt(to.Address); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(raw); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// build dựng thư MIME multipart/alternative: một phần chữ thường, một phần HTML; ứng dụng mail
// chọn phần hiển thị được. Tiêu đề có dấu tiếng Việt phải mã hoá (RFC 2047), nội dung mã hoá
// quoted-printable để đi an toàn qua mọi máy chủ mail.
func (s *SMTP) build(to *mail.Address, m Message) ([]byte, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	boundary := "airlife-" + hex.EncodeToString(b)

	var buf bytes.Buffer
	// mail.Address.String() tự mã hoá tên có dấu; mime.QEncoding cho tiêu đề. Không ghép chuỗi
	// thô: tiêu đề chứa ký tự xuống dòng là chèn được header lạ vào thư (header injection).
	fmt.Fprintf(&buf, "From: %s\r\n", s.from.String())
	fmt.Fprintf(&buf, "To: %s\r\n", to.String())
	fmt.Fprintf(&buf, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", m.Subject))
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	buf.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)

	for _, part := range []struct{ ctype, body string }{
		{"text/plain", m.Text},
		{"text/html", m.HTML},
	} {
		fmt.Fprintf(&buf, "--%s\r\n", boundary)
		fmt.Fprintf(&buf, "Content-Type: %s; charset=utf-8\r\n", part.ctype)
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		qp := quotedprintable.NewWriter(&buf)
		if _, err := qp.Write([]byte(part.body)); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
		buf.WriteString("\r\n")
	}
	fmt.Fprintf(&buf, "--%s--\r\n", boundary)
	return buf.Bytes(), nil
}
