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
