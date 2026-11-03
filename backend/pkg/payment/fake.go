package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/refcode"
)

const fakeName = "fake"

// Fake là cổng thanh toán GIẢ LẬP, chỉ để phát triển và kiểm thử khi chưa có tài khoản cổng thật.
//
// Nó diễn đúng luồng của một cổng thật, kể cả phần khó:
//  1. Ta tạo "phiên thanh toán" → nhận link, chuyển khách tới trang của cổng (/thanh-toan-gia-lap/<txn>).
//  2. Khách bấm "thanh toán" ở trang đó → cổng gọi webhook về API của ta, KÝ bằng HMAC.
//  3. Cổng đưa khách về trang đặt chỗ (return URL). Webhook và việc đưa khách về là hai đường độc
//     lập, có thể đến theo thứ tự nào cũng được.
//
// Trạng thái phiên giữ trong Redis (24 giờ). KHÔNG dùng ở production (config chặn).
type Fake struct {
	rdb       *redis.Client
	secret    string
	publicURL string // trang web, để ghép link tới trang cổng giả lập
	notifyURL string // địa chỉ webhook của API
	http      *http.Client
}

func NewFake(rdb *redis.Client, secret, publicURL, notifyURL string) *Fake {
	return &Fake{
		rdb: rdb, secret: secret, publicURL: publicURL, notifyURL: notifyURL,
		http: &http.Client{Timeout: 5 * time.Second},
	}
}

func (f *Fake) Name() string { return fakeName }

func key(txn string) string { return "fakegw:" + txn }

func (f *Fake) CreateCheckout(ctx context.Context, req CheckoutRequest) (Checkout, error) {
	txn := refcode.New("FK-")
	pipe := f.rdb.TxPipeline()
	pipe.HSet(ctx, key(txn), map[string]any{
		"code": req.PaymentCode, "amount": req.Amount, "desc": req.Description,
		"return_url": req.ReturnURL, "status": string(StatusPending),
	})
	pipe.Expire(ctx, key(txn), 24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return Checkout{}, err
	}
	return Checkout{Txn: txn, URL: f.publicURL + "/thanh-toan-gia-lap/" + txn}, nil
}

// Session: thông tin phiên để trang cổng giả lập hiện ra.
type Session struct {
	Txn         string `json:"txn"`
	Description string `json:"description"`
	Amount      int64  `json:"amount"`
	Status      Status `json:"status"`
	ReturnURL   string `json:"return_url"`
}

var ErrNoSession = errors.New("không có phiên thanh toán")

func (f *Fake) Session(ctx context.Context, txn string) (Session, error) {
	m, err := f.rdb.HGetAll(ctx, key(txn)).Result()
	if err != nil {
		return Session{}, err
	}
	if len(m) == 0 {
		return Session{}, ErrNoSession
	}
	amount, _ := strconv.ParseInt(m["amount"], 10, 64)
	return Session{
		Txn: txn, Description: m["desc"], Amount: amount, Status: Status(m["status"]), ReturnURL: m["return_url"],
	}, nil
}

// Complete: khách bấm nút ở trang cổng giả lập. result: "succeeded" hoặc "failed". Cập nhật phiên
// rồi gọi webhook về API (ký HMAC), đúng như cổng thật. Trả return URL để trình duyệt quay về.
func (f *Fake) Complete(ctx context.Context, txn string, result Status) (string, error) {
	if result != StatusSucceeded && result != StatusFailed {
		return "", fmt.Errorf("kết quả không hợp lệ: %q", result)
	}
	s, err := f.Session(ctx, txn)
	if err != nil {
		return "", err
	}
	// Chỉ phiên còn "pending" mới đổi được: trả tiền xong không "trả lần hai" được
	ok, err := f.rdb.HSetNX(ctx, key(txn), "settled", "1").Result()
	if err != nil {
		return "", err
	}
	if !ok {
		return s.ReturnURL, nil
	}
	if err := f.rdb.HSet(ctx, key(txn), "status", string(result)).Err(); err != nil {
		return "", err
	}
	code, _ := f.rdb.HGet(ctx, key(txn), "code").Result()
	if err := f.Notify(ctx, webhookBody{
		EventID: uuid.NewString(), PaymentCode: code, Txn: txn, Status: result, Amount: s.Amount,
	}); err != nil {
		// Cổng thật sẽ thử lại webhook sau; cổng giả lập không. Mất webhook thì job đối soát
		// (internal/payment.Reconcile) hỏi lại bằng Query.
		return s.ReturnURL, fmt.Errorf("gọi webhook: %w", err)
	}
	return s.ReturnURL, nil
}

type webhookBody struct {
	EventID     string `json:"event_id"`
	PaymentCode string `json:"payment_code"`
	Txn         string `json:"txn"`
	Status      Status `json:"status"`
	Amount      int64  `json:"amount"`
}

// Notify gửi webhook có chữ ký tới API (cũng dùng để thử gửi trùng, sai số tiền…).
func (f *Fake) Notify(ctx context.Context, b webhookBody) error {
	body, err := json.Marshal(b)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.notifyURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(HeaderSignature, Sign(f.secret, time.Now(), body))
	resp, err := f.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("API trả %d", resp.StatusCode)
	}
	return nil
}

func (f *Fake) ParseWebhook(h http.Header, body []byte) (Event, error) {
	if err := Verify(f.secret, h, body, time.Now()); err != nil {
		return Event{}, err
	}
	var b webhookBody
	if err := json.Unmarshal(body, &b); err != nil || b.EventID == "" || b.PaymentCode == "" {
		return Event{}, ErrBadPayload
	}
	return Event{ID: b.EventID, PaymentCode: b.PaymentCode, Txn: b.Txn, Status: b.Status, Amount: b.Amount}, nil
}

func (f *Fake) Query(ctx context.Context, txn string) (Event, error) {
	s, err := f.Session(ctx, txn)
	if err != nil {
		return Event{}, err
	}
	code, _ := f.rdb.HGet(ctx, key(txn), "code").Result()
	// ID có kèm trạng thái: kết quả đối soát "đã trả" và "chưa trả" là hai sự kiện khác nhau
	return Event{
		ID: "query:" + txn + ":" + string(s.Status), PaymentCode: code, Txn: txn, Status: s.Status, Amount: s.Amount,
	}, nil
}
