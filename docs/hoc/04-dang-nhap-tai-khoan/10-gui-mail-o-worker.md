# Bài 4.10: Gửi mail ở worker: SMTP, mẫu email, consumer

> [← Bài trước](09-mailpit-va-hang-doi-job.md) · [Mục lục](../README.md) · [Bài sau →](11-xac-minh-email-quen-mat-khau.md)

## Mục tiêu

Worker nhận job `email.send`, dựng thư từ mẫu (HTML + chữ thường), gửi qua SMTP. Mailpit tắt thì job
được thử lại, bật lại thì thư tới.

## Bạn sẽ học

- Dựng thư MIME `multipart/alternative`, mã hoá tiêu đề tiếng Việt, chống header injection.
- `html/template` tự escape; `embed` nhúng mẫu vào binary.
- Nhiều việc nền trong worker với `sync.WaitGroup.Go`.
- Đọc lint gosec: phân biệt cảnh báo thật và **báo nhầm**.

## Viết code

### Bước 1: `backend/pkg/mailer/smtp.go`

```go
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
```

- **Không dùng `smtp.SendMail`**: hàm đó không có context, không có thời hạn. Máy chủ mail treo là worker
  treo theo. Tự kết nối bằng `net.Dialer{Timeout}` và đặt `SetDeadline`.
- **`mime.QEncoding.Encode`** cho tiêu đề: "Xác minh email" thành `=?utf-8?q?X=C3=A1c_minh…?=`, ứng dụng
  mail nào cũng hiện đúng dấu.
- **Header injection**: nếu ghép chuỗi thô `"Subject: " + subject` mà subject có `\r\nBcc: ai@do.com`
  thì thư bị gửi thêm cho người lạ. Mã hoá tiêu đề và dùng `mail.Address` thì ký tự xuống dòng không lọt vào header.

### Bước 2: Mẫu email

#### `backend/internal/mail/mail.go`

```go
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
)

// gosec G101 báo nhầm map này là "mật khẩu ghi cứng" vì có chữ "mật khẩu" trong tiêu đề email.
var subjects = map[string]string{ //nolint:gosec // xem comment trên
	TemplateVerifyEmail:   "Xác minh email tài khoản Airlife",
	TemplateResetPassword: "Đặt lại mật khẩu Airlife",
}

// Job: nội dung đẩy vào hàng đợi. Chỉ chứa tên mẫu và dữ liệu, không chứa HTML: đổi giao diện
// email chỉ cần sửa mẫu và khởi động lại worker, job đang chờ trong hàng đợi cũng dùng mẫu mới.
type Job struct {
	Template string            `json:"template"`
	To       string            `json:"to"`
	Data     map[string]string `json:"data"`
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
```

- **Job chỉ chứa tên mẫu + dữ liệu**, không chứa HTML: sửa giao diện thư thì chỉ cần sửa mẫu và khởi
  động lại worker.
- **`html/template`**: tên người dùng là `<b>Hack</b>` thì thư hiện đúng chữ đó, không thành chữ đậm.
- **`//nolint:gosec // xem comment trên`**: gosec G101 ("mật khẩu ghi cứng trong code") báo nhầm vì có chữ
  "mật khẩu" trong tiêu đề email. Lúc đầu đặt `nolint` ở dòng có chữ đó thì vẫn bị báo: gosec báo ở
  dòng **mở đầu** khai báo (`var subjects = …{`), nên `nolint` phải đặt đúng dòng đó.

#### Các file mẫu trong `backend/internal/mail/templates/`

`layout.html` (khung chung: `header`, `footer`):

```html
{{define "header"}}<!doctype html>
<html lang="vi">
<body style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td style="font-size:24px;font-weight:bold;color:#6c3c8b;padding-bottom:16px">Airlife</td></tr>
{{end}}
{{define "footer"}}
        <tr><td style="font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px">
          Airlife – Đời sống hàng không. Nếu bạn không thực hiện thao tác này, hãy bỏ qua email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>{{end}}
```

`verify_email.html`:

```html
{{template "header"}}
        <tr><td style="font-size:16px;line-height:1.6">
          Chào {{.name}},<br><br>
          Cảm ơn bạn đã đăng ký Airlife. Bấm nút dưới đây để xác minh email của bạn.
          Liên kết có hiệu lực trong 24 giờ.
        </td></tr>
        <tr><td style="padding:24px 0">
          <a href="{{.link}}" style="display:inline-block;background:#6c3c8b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">Xác minh email</a>
        </td></tr>
        <tr><td style="font-size:13px;color:#64748b;padding-bottom:16px;word-break:break-all">
          Nút không bấm được? Mở liên kết: {{.link}}
        </td></tr>
{{template "footer"}}
```

`verify_email.txt`:

```text
Chào {{.name}},

Cảm ơn bạn đã đăng ký Airlife. Mở liên kết dưới đây để xác minh email (hiệu lực 24 giờ):

{{.link}}

Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.
Airlife – Đời sống hàng không
```

`reset_password.html`:

```html
{{template "header"}}
        <tr><td style="font-size:16px;line-height:1.6">
          Chào {{.name}},<br><br>
          Có yêu cầu đặt lại mật khẩu cho tài khoản Airlife của bạn. Bấm nút dưới đây để đặt mật khẩu mới.
          Liên kết có hiệu lực trong 30 phút và chỉ dùng được một lần.
        </td></tr>
        <tr><td style="padding:24px 0">
          <a href="{{.link}}" style="display:inline-block;background:#6c3c8b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">Đặt lại mật khẩu</a>
        </td></tr>
        <tr><td style="font-size:13px;color:#64748b;padding-bottom:16px;word-break:break-all">
          Nút không bấm được? Mở liên kết: {{.link}}
        </td></tr>
{{template "footer"}}
```

`reset_password.txt`:

```text
Chào {{.name}},

Có yêu cầu đặt lại mật khẩu cho tài khoản Airlife của bạn. Mở liên kết dưới đây để đặt mật khẩu mới
(hiệu lực 30 phút, chỉ dùng một lần):

{{.link}}

Nếu bạn không yêu cầu, hãy bỏ qua email; mật khẩu của bạn không thay đổi.
Airlife – Đời sống hàng không
```

HTML email dùng **bảng và style viết thẳng trong thẻ** (inline), không dùng `<style>` hay flex/grid:
nhiều ứng dụng mail (Gmail, Outlook) bỏ `<style>` và không hiểu CSS hiện đại.

### Bước 3: Worker nhận job, `backend/cmd/worker/main.go`

```go
// Command worker chạy các việc nền: nhận job từ RabbitMQ (gửi email…) và các việc định kỳ
// (gom lượt xem từ Redis về PostgreSQL…). File này lớn dần qua các phần của khoá học.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/database"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/logger"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/mailer"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker dừng do lỗi", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.Log.Level, cfg.Log.Format)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPostgres(ctx, cfg.Postgres.URL, cfg.Postgres.MaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb, err := cache.NewRedis(ctx, cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }() // lỗi khi đóng lúc tắt không xử lý được gì thêm

	mq, err := queue.NewRabbitMQ(cfg.RabbitMQ.URL)
	if err != nil {
		return err
	}
	defer func() { _ = mq.Close() }()

	log.Info("worker đang chạy", "env", cfg.App.Env)

	// Gửi mail: dev gửi vào Mailpit (MAIL_SMTP_ADDR do docker-compose.yml đặt)
	if cfg.Mail.SMTPAddr == "" {
		return errors.New("thiếu biến môi trường MAIL_SMTP_ADDR")
	}
	smtp, err := mailer.NewSMTP(cfg.Mail.SMTPAddr, cfg.Mail.From)
	if err != nil {
		return err
	}
	if err := queue.DeclareJobQueue(mq, mail.Queue); err != nil {
		return err
	}

	// Các việc nền chạy trong goroutine riêng, dùng chung loopCtx. Khi run() kết thúc (tắt worker,
	// mất RabbitMQ, hay một việc nền lỗi), defer dưới đây huỷ loopCtx rồi CHỜ mọi việc dừng hẳn.
	// defer chạy theo thứ tự ngược, nên defer này (khai báo sau cùng) chạy TRƯỚC các defer đóng
	// PostgreSQL, Redis ở trên: lần gom lượt xem cuối vẫn còn kết nối để dùng.
	mediaSvc := media.NewService(media.NewRepository(db.New(pool)), rdb)
	loopCtx, stopLoop := context.WithCancel(ctx)
	var wg sync.WaitGroup
	jobErr := make(chan error, 1)
	wg.Go(func() { flushViewsLoop(loopCtx, log, mediaSvc) })
	wg.Go(func() {
		// prefetch 5: mỗi lúc xử lý tối đa 5 thư chưa xong
		if err := queue.Consume(loopCtx, mq, mail.Queue, 5, log, mail.Handle(smtp)); err != nil {
			jobErr <- fmt.Errorf("nhận job gửi mail: %w", err)
		}
	})
	defer func() {
		stopLoop()
		wg.Wait()
	}()

	// Mất kết nối RabbitMQ thì thoát với lỗi để Docker khởi động lại worker
	// (restart: unless-stopped). Tự kết nối lại sẽ làm ở phần hàng đợi.
	closed := mq.NotifyClose(make(chan *amqp.Error, 1))
	select {
	case <-ctx.Done():
		log.Info("worker đã tắt")
		return nil
	case err := <-jobErr:
		return err
	case amqpErr := <-closed:
		// Phải kiểm tra nil riêng: trả thẳng một *amqp.Error nil qua kiểu error
		// sẽ ra error KHÁC nil (interface chứa con trỏ nil).
		if amqpErr == nil {
			return errors.New("kết nối rabbitmq bị đóng")
		}
		return fmt.Errorf("mất kết nối rabbitmq: %w", amqpErr)
	}
}

// flushViewsLoop: 30 giây một lần, gom lượt xem từ Redis vào PostgreSQL (internal/media/views.go).
// Lần gom cuối khi tắt worker dùng context mới, vì ctx đã bị huỷ.
func flushViewsLoop(ctx context.Context, log *slog.Logger, svc *media.Service) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	flush := func(ctx context.Context) {
		n, err := svc.FlushViews(ctx)
		if err != nil {
			log.ErrorContext(ctx, "gom lượt xem lỗi", "err", err)
			return
		}
		if n > 0 {
			log.InfoContext(ctx, "đã gom lượt xem", "media", n)
		}
	}
	for {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			flush(shutdownCtx)
			cancel()
			return
		case <-ticker.C:
			flush(ctx)
		}
	}
}
```

- **`wg.Go(func() {...})`** (Go 1.25+): chạy hàm trong goroutine mới và tự `Add`/`Done` cho WaitGroup.
  Defer cuối `stopLoop(); wg.Wait()` chờ **mọi** việc nền dừng hẳn trước khi đóng kết nối.
- **`jobErr`**: consumer chết (kênh RabbitMQ đóng) thì worker thoát với lỗi, Docker khởi động lại.

## Kiểm tra

```bash
make lint && make restart s=worker
make logs s=worker        # msg="đang nhận job" queue=email.send
```

Ở http://localhost:15672 (tab Queues) có `email.send`, `email.send.retry`, `email.send.dead`.

Thử lại khi máy chủ mail sập (sau bài 4.11, khi API đã đẩy job lúc đăng ký):

```bash
docker compose stop mailpit
curl -s -H Content-Type:application/json \
  -d '{"email":"thu-lai@example.com","password":"matkhau-rat-dai","display_name":"Thử Lại"}' \
  localhost:8080/api/v1/auth/register
make logs s=worker        # msg="job lỗi, thử lại sau" attempt=1 err="kết nối SMTP: …"
docker compose start mailpit
```

Khoảng 30 giây sau, thư "Xác minh email" xuất hiện ở http://localhost:8025. Số lượng ở trang quản trị
RabbitMQ cập nhật chậm vài giây, đừng vội kết luận.

```bash
git add . && git commit -m "Gửi mail ở worker"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Worker thoát: `thiếu biến môi trường MAIL_SMTP_ADDR` | Thiếu trong `docker-compose.yml` (khối `x-backend`) |
| `MAIL_FROM không hợp lệ` | Dạng đúng: `Airlife <no-reply@airlife.local>` |
| `template: … no such template "verify_email.html"` | Thiếu file mẫu, hoặc `//go:embed templates/*` sai đường dẫn |
| Tiêu đề thư hiện `Xác minh` thành ký tự lạ | Thiếu `mime.QEncoding.Encode` |
