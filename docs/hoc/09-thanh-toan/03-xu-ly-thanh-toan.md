# Bài 9.03: Tạo phiên thanh toán và xử lý kết quả (webhook, đối soát)

> [← Bài trước](02-cong-thanh-toan-va-chu-ky.md) · [Mục lục](../README.md) · [Bài sau →](04-noi-day-va-doi-soat.md)

## Mục tiêu

`backend/internal/payment`: `Start` (tạo phiên, trả link sang cổng), `apply` (áp kết quả của một giao dịch
lên đơn, dùng chung cho webhook và đối soát), `Reconcile`.

## Bạn sẽ học

- Gọi dịch vụ bên ngoài **ngoài** transaction.
- Một hàm `apply` idempotent: khoá dòng + nhật ký sự kiện.
- Liệt kê và xử lý từng "tình huống xấu" của thanh toán.
- Gửi email sau commit.

## Viết code

Trước hết, tách hàm định dạng tiền ra gói dùng chung (đơn hàng đã có `FormatVND`; email xác nhận đặt chỗ
cần nó). `backend/pkg/money/money.go`:

```go
// Package money: định dạng tiền Việt Nam. Tiền luôn là số nguyên, đơn vị đồng (xem bài 7.01).
package money

import (
	"strconv"
	"strings"
)

// FormatVND: 389000 → "389.000₫"
func FormatVND(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return b.String() + "₫"
}
```

Trong `backend/internal/order/order.go` xoá hàm `FormatVND` cũ và đổi chỗ gọi thành `money.FormatVND`.

Thêm mẫu email xác nhận đặt chỗ. `backend/internal/mail/mail.go` thêm `TemplateBookingConfirmed =
"booking_confirmed"` và tiêu đề "Đặt chỗ của bạn đã được xác nhận" (bản đầy đủ):

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
	TemplateVerifyEmail      = "verify_email"
	TemplateResetPassword    = "reset_password"
	TemplateOrderCreated     = "order_created"
	TemplateBookingConfirmed = "booking_confirmed"
)

// gosec G101 báo nhầm map này là "mật khẩu ghi cứng" vì có chữ "mật khẩu" trong tiêu đề email.
var subjects = map[string]string{ //nolint:gosec // xem comment trên
	TemplateVerifyEmail:      "Xác minh email tài khoản Airlife",
	TemplateResetPassword:    "Đặt lại mật khẩu Airlife",
	TemplateOrderCreated:     "Airlife đã nhận đơn hàng của bạn",
	TemplateBookingConfirmed: "Đặt chỗ của bạn đã được xác nhận",
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
```

`backend/internal/mail/templates/booking_confirmed.html`:

```html
{{template "header"}}
        <tr><td style="font-size:16px;line-height:1.6">
          Chào {{.name}},<br><br>
          Airlife đã nhận thanh toán và <b>xác nhận đặt chỗ {{.code}}</b>.
        </td></tr>
        <tr><td style="padding:16px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
            <tr><td style="padding:6px 0;color:#64748b">Dịch vụ</td><td align="right" style="padding:6px 0">{{.product}}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Hạng</td><td align="right" style="padding:6px 0">{{.fare}}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Khởi hành</td><td align="right" style="padding:6px 0">{{.date}}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;border-top:1px solid #e2e8f0">Đã thanh toán</td>
                <td align="right" style="padding:8px 0;font-weight:bold;border-top:1px solid #e2e8f0">{{.total}}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="{{.link}}" style="display:inline-block;background:#6c3c8b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">Xem đặt chỗ</a>
        </td></tr>
{{template "footer"}}
```

`backend/internal/mail/templates/booking_confirmed.txt`:

```text
Chào {{.name}},

Airlife đã nhận thanh toán và xác nhận đặt chỗ {{.code}}.

Dịch vụ: {{.product}}
Hạng: {{.fare}}
Khởi hành: {{.date}}
Đã thanh toán: {{.total}}

Xem đặt chỗ: {{.link}}

Airlife – Đời sống hàng không
```

### `backend/internal/payment/payment.go`

```go
// Package payment: thanh toán online cho đơn đặt vé, tour. Tạo phiên thanh toán ở cổng, nhận
// webhook, đối soát khi mất webhook.
//
// Nguyên tắc của mọi hệ thống thanh toán:
//  1. Tiền là chuyện của cổng. Trình duyệt của khách nói "tôi trả rồi" thì KHÔNG đáng tin; chỉ
//     webhook có chữ ký (hoặc câu trả lời của chính cổng khi ta hỏi) mới được xác nhận đơn.
//  2. Webhook có thể đến trễ, đến hai lần, đến sau khi khách đã về trang của ta, hoặc không đến.
//     Xử lý phải chạy lại được nhiều lần mà kết quả không đổi (idempotent).
//  3. Đã nhận tiền mà không giao được dịch vụ thì KHÔNG được nuốt: đánh dấu refund_required.
package payment

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/money"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/refcode"
)

const (
	// Khách đã sang trang của cổng để trả tiền: giữ chỗ ít nhất thêm chừng này kể từ lúc bấm
	// "Thanh toán", để họ kịp nhập thẻ, OTP mà không bị worker trả chỗ giữa chừng.
	payGrace = 10 * time.Minute
	// Đối soát các khoản "chờ" quá lâu (giây): webhook thường đến trong vài giây
	reconcileAfterSeconds = 180
)

var (
	errBookingNotFound = apperr.NotFound("booking_not_found", "Không tìm thấy đơn đặt chỗ")
	errNotPayable      = apperr.Conflict("booking_not_payable",
		"Đơn này không thanh toán được: chưa điền hành khách, đã hết hạn giữ chỗ, đã huỷ hoặc đã thanh toán")
)

// Publisher: đẩy job vào hàng đợi (queue.Publisher).
type Publisher interface {
	Publish(ctx context.Context, queueName string, job any) error
}

type Service struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	gw        payment.Gateway
	mail      Publisher
	publicURL string
	log       *slog.Logger
}

func NewService(pool *pgxpool.Pool, gw payment.Gateway, mail Publisher, publicURL string, log *slog.Logger) *Service {
	return &Service{pool: pool, q: db.New(pool), gw: gw, mail: mail, publicURL: publicURL, log: log}
}

// Provider: tên cổng đang dùng (đường dẫn webhook phải khớp).
func (s *Service) Provider() string { return s.gw.Name() }

// Start tạo phiên thanh toán cho một đơn đặt chỗ, trả link để chuyển khách sang cổng.
func (s *Service) Start(ctx context.Context, userID uuid.UUID, bookingCode string) (string, error) {
	var (
		paymentID   uuid.UUID
		paymentCode = refcode.New("PM-")
		b           db.GetBookingForPaymentRow
	)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		var err error
		// Khoá đơn: hai request "Thanh toán" cùng lúc xếp hàng, không sinh hai phiên song song
		b, err = q.GetBookingForPayment(ctx, db.GetBookingForPaymentParams{UserID: userID, Code: bookingCode})
		if errors.Is(err, pgx.ErrNoRows) {
			return errBookingNotFound
		}
		if err != nil {
			return err
		}
		if b.Status != "awaiting_payment" || !time.Now().Before(b.ExpiresAt) {
			return errNotPayable
		}
		// Khách bấm "Thanh toán" lại (đóng tab cổng, trả không được): phiên cũ hết hiệu lực
		if err := q.ExpirePendingPayments(ctx, b.ID); err != nil {
			return err
		}
		if err := q.ExtendHold(ctx, db.ExtendHoldParams{ID: b.ID, Until: time.Now().Add(payGrace)}); err != nil {
			return err
		}
		paymentID, err = q.CreatePayment(ctx, db.CreatePaymentParams{
			Code: paymentCode, UserID: userID, BookingID: b.ID, Provider: s.gw.Name(), Amount: b.Total,
		})
		return err
	})
	if err != nil {
		return "", err
	}

	// Gọi cổng NGOÀI transaction: không giữ khoá dòng trong lúc chờ một dịch vụ bên ngoài
	co, err := s.gw.CreateCheckout(ctx, payment.CheckoutRequest{
		PaymentCode: paymentCode, Amount: b.Total,
		Description: fmt.Sprintf("Airlife %s - %s", b.Code, b.ProductName),
		ReturnURL:   s.publicURL + "/dat-cho/" + b.Code + "?tt=1",
	})
	if err != nil {
		_ = s.q.FailPayment(ctx, db.FailPaymentParams{ID: paymentID, FailureReason: ptr("gateway_error")})
		return "", fmt.Errorf("tạo phiên thanh toán: %w", err)
	}
	if err := s.q.SetPaymentTxn(ctx, db.SetPaymentTxnParams{ID: paymentID, ProviderTxn: &co.Txn}); err != nil {
		return "", err
	}
	return co.URL, nil
}

// HandleWebhook: cổng báo kết quả giao dịch. Trả nil (HTTP 200) cả khi sự kiện trùng hoặc không thuộc
// về ta: cổng thấy lỗi sẽ gửi lại mãi, mà gửi lại cũng không làm sự kiện đó xử lý được.
func (s *Service) HandleWebhook(ctx context.Context, header http.Header, body []byte) error {
	ev, err := s.gw.ParseWebhook(header, body)
	if err != nil {
		return err // chữ ký sai, nội dung hỏng: handler trả 400
	}
	return s.apply(ctx, ev)
}

// Reconcile (worker gọi định kỳ): hỏi cổng về các khoản đã "chờ" lâu mà chưa thấy webhook.
func (s *Service) Reconcile(ctx context.Context) (int, error) {
	rows, err := s.q.ListPendingPayments(ctx, reconcileAfterSeconds)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, r := range rows {
		if r.Provider != s.gw.Name() || r.ProviderTxn == nil {
			continue
		}
		ev, err := s.gw.Query(ctx, *r.ProviderTxn)
		if err != nil {
			s.log.WarnContext(ctx, "đối soát: hỏi cổng lỗi", "payment", r.Code, "err", err)
			continue
		}
		if ev.Status == payment.StatusPending {
			continue // khách chưa trả xong, hoặc còn đang ở trang của cổng
		}
		if err := s.apply(ctx, ev); err != nil {
			s.log.ErrorContext(ctx, "đối soát: áp kết quả lỗi", "payment", r.Code, "err", err)
			continue
		}
		done++
	}
	return done, nil
}

// confirmed: dữ liệu để gửi email xác nhận, có sau khi transaction đã commit.
type confirmed struct {
	to, name, code, product, fare, date string
	total                               int64
}

// apply áp kết quả của một giao dịch lên payments và bookings. Webhook và đối soát cùng gọi hàm này,
// có thể cùng lúc, có thể lặp lại: khoá dòng payment (FOR UPDATE) cho chúng xếp hàng, bảng
// payment_events chặn xử lý trùng.
func (s *Service) apply(ctx context.Context, ev payment.Event) error {
	var done *confirmed
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		p, err := q.GetPaymentForUpdate(ctx, ev.PaymentCode)
		if errors.Is(err, pgx.ErrNoRows) {
			s.log.WarnContext(ctx, "sự kiện thanh toán không có khoản tương ứng", "payment", ev.PaymentCode, "event", ev.ID)
			return nil
		}
		if err != nil {
			return err
		}
		n, err := q.InsertPaymentEvent(ctx, db.InsertPaymentEventParams{Provider: p.Provider, EventID: ev.ID, PaymentID: p.ID})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // sự kiện này xử lý rồi
		}

		switch ev.Status {
		case payment.StatusFailed:
			// Chỉ khoản đang chờ mới "thất bại" được. Khoản đã thành công không bị một thông báo
			// thất bại đến muộn (hoặc bị giả mạo) lật ngược.
			if p.Status != "pending" {
				return nil
			}
			return q.FailPayment(ctx, db.FailPaymentParams{ID: p.ID, FailureReason: ptr("declined")})

		case payment.StatusSucceeded:
			// Thành công đến cho khoản "pending", hoặc "expired" (khách đã mở phiên mới nhưng lại
			// trả ở phiên cũ: tiền đã đi thật). Các trạng thái khác: đã xử lý xong.
			if p.Status != "pending" && p.Status != "expired" {
				return nil
			}
			done, err = s.settle(ctx, q, p, ev)
			return err
		default:
			return nil
		}
	})
	if err != nil {
		return err
	}
	if done != nil {
		// Gửi mail SAU commit, và lỗi gửi không làm hỏng việc xác nhận (đơn đã xác nhận rồi)
		if err := s.sendConfirmed(ctx, *done); err != nil {
			s.log.ErrorContext(ctx, "không đẩy được email xác nhận đặt chỗ", "booking", done.code, "err", err)
		}
	}
	return nil
}

// settle xử lý tiền ĐÃ VÀO: xác nhận đơn nếu giao được dịch vụ, không thì đánh dấu cần hoàn tiền.
func (s *Service) settle(ctx context.Context, q *db.Queries, p db.GetPaymentForUpdateRow, ev payment.Event) (*confirmed, error) {
	// Số tiền cổng ghi nhận phải KHỚP số ta yêu cầu. Lệch (lỗi cổng, hoặc kẻ gian sửa số tiền ở
	// trang cổng): không xác nhận đơn; tiền đã đi nên đánh dấu hoàn.
	if ev.Amount != p.Amount {
		s.log.ErrorContext(ctx, "số tiền thanh toán lệch", "payment", ev.PaymentCode, "expected", p.Amount, "got", ev.Amount)
		return nil, q.FailPayment(ctx, db.FailPaymentParams{ID: p.ID, FailureReason: ptr("amount_mismatch"), RefundRequired: true})
	}
	b, err := q.GetBookingByIDForUpdate(ctx, p.BookingID)
	if err != nil {
		return nil, err
	}

	refund := false
	switch b.Status {
	case "awaiting_payment", "held":
		// bình thường
	case "expired":
		// Khách trả chậm, worker đã trả chỗ. Còn chỗ thì lấy lại và xác nhận; hết thì hoàn tiền.
		taken, err := q.TakeSeats(ctx, db.TakeSeatsParams{
			Seats: int32(b.Adults + b.Children), DepartureID: b.DepartureID, FareID: b.FareID,
		})
		if err != nil {
			return nil, err
		}
		refund = taken == 0
	default:
		// confirmed: khách đã trả ở một phiên khác (trả trùng); cancelled: khách huỷ rồi mới trả.
		// Không "hồi sinh" đơn đã huỷ. Cả hai: tiền đã vào, hoàn lại.
		s.log.WarnContext(ctx, "thanh toán cho đơn không còn hiệu lực", "booking", b.Code, "status", b.Status)
		return nil, q.FailPayment(ctx, db.FailPaymentParams{
			ID: p.ID, FailureReason: ptr("booking_" + b.Status), RefundRequired: true,
		})
	}

	txn := nilIfEmpty(ev.Txn)
	if err := q.MarkPaymentSucceeded(ctx, db.MarkPaymentSucceededParams{ID: p.ID, RefundRequired: refund, Txn: txn}); err != nil {
		return nil, err
	}
	if refund {
		s.log.ErrorContext(ctx, "đã nhận tiền nhưng hết chỗ: cần hoàn tiền", "booking", b.Code, "payment", ev.PaymentCode)
		return nil, nil
	}
	if err := q.ConfirmBooking(ctx, b.ID); err != nil {
		return nil, err
	}
	c := &confirmed{
		name: deref(b.ContactName), to: deref(b.ContactEmail), code: b.Code, product: b.ProductName,
		fare: b.FareLabel, date: b.DepartDate.Format("02/01/2006"), total: b.Total,
	}
	return c, nil
}

func (s *Service) sendConfirmed(ctx context.Context, c confirmed) error {
	return s.mail.Publish(ctx, mail.Queue, mail.Job{
		Template: mail.TemplateBookingConfirmed,
		To:       c.to,
		Data: map[string]any{
			"name": c.name, "code": c.code, "product": c.product, "fare": c.fare, "date": c.date,
			"total": money.FormatVND(c.total), "link": s.publicURL + "/dat-cho/" + c.code,
		},
	})
}

func ptr(s string) *string { return &s }

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
```

**`Start`**

- Khoá đơn rồi mới tạo phiên: hai lần bấm "Thanh toán" cùng lúc xếp hàng, không sinh hai phiên song song.
- Đơn phải `awaiting_payment` (đã điền hành khách) và chưa quá giờ.
- Phiên cũ đang chờ → `expired`. Giữ chỗ được kéo dài tới ít nhất 10 phút kể từ bây giờ: khách sang trang
  cổng nhập thẻ, OTP mất thời gian, không được để worker trả chỗ giữa chừng.
- **Gọi cổng ngoài transaction**: giữ khoá dòng trong lúc chờ một dịch vụ bên ngoài (có thể mất vài giây
  hoặc treo) sẽ làm mọi request khác đụng đơn đó phải chờ theo. Hệ quả: có thể có một dòng `payments` mà
  chưa có `provider_txn` (cổng lỗi giữa chừng): đánh dấu `failed` với lý do `gateway_error`.

**`apply`: tám tình huống**

| Sự kiện đến | Kết quả |
|---|---|
| Thành công, đơn đang chờ | Khoản `succeeded`, đơn `confirmed`, gửi email |
| Cùng sự kiện lần hai (cổng gửi lại) | `payment_events` chặn, không làm gì |
| Thất bại | Khoản `failed`; đơn vẫn chờ, khách thử lại được |
| Thất bại đến muộn sau khi đã thành công | Bỏ qua: chỉ khoản `pending` mới "thất bại" được |
| Thành công nhưng **sai số tiền** | Khoản `failed` (`amount_mismatch`), `refund_required`; **không** xác nhận đơn |
| Thành công ở **phiên cũ** (đã bị thay) | Tiền đã đi thật: vẫn xác nhận đơn |
| Thành công, đơn đã **hết hạn** | Lấy lại chỗ (`TakeSeats`): còn thì xác nhận, hết thì `refund_required` |
| Thành công, đơn đã **huỷ** hoặc đã **xác nhận bằng phiên khác** (trả trùng) | `refund_required`, không hồi sinh đơn |

- **Sai số tiền**: số tiền trong webhook phải khớp số ta đã yêu cầu. Lệch (lỗi cổng, hoặc ai đó sửa số
  tiền ở trang cổng) thì không xác nhận; tiền đã đi nên cần hoàn.
- **Không hồi sinh đơn đã huỷ**: khách chủ động huỷ rồi lại trả tiền ở tab cũ là hai ý muốn mâu thuẫn;
  chọn an toàn: hoàn tiền. Đơn **hết hạn** thì khác: khách vẫn muốn mua, chỉ trả chậm.
- **Thứ tự trong transaction**: khoá khoản thanh toán (`FOR UPDATE`) → ghi sự kiện (`InsertPaymentEvent`)
  → mới xử lý. Webhook và đối soát cùng đến một khoản: bên sau chờ khoá, rồi thấy sự kiện/trạng thái đã xử lý.
- **Mail sau commit**: gửi trong transaction mà transaction lỗi thì khách nhận thư xác nhận cho đơn chưa
  xác nhận. Lỗi gửi mail không làm hỏng việc xác nhận (đã commit).
- **Sự kiện của khoản không tồn tại**: ghi log cảnh báo và trả thành công (200). Trả lỗi thì cổng gửi lại
  mãi mà vô ích.

**`Reconcile`** hỏi cổng về các khoản `pending` quá 3 phút (và chưa quá 24 giờ), dùng chung `apply`. Kết quả
"vẫn đang chờ" thì bỏ qua.

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Khách trả rồi mà đơn vẫn "Chờ thanh toán" | Webhook không tới (sai địa chỉ, API tắt): job đối soát (bài 9.04) sẽ áp kết quả sau vài phút |
| Hai request cùng xử lý một webhook, đơn xác nhận hai lần | Thiếu `FOR UPDATE` trên khoản thanh toán, hoặc thiếu bảng `payment_events` |
| Cổng gửi lại webhook mãi | Handler trả 4xx/5xx cho sự kiện không xử lý được; sự kiện trùng/không thuộc về ta phải trả 2xx |
