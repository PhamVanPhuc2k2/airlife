# Bài 9.02: Cổng thanh toán sau một interface, chữ ký webhook, cổng giả lập

> [← Bài trước](01-nguyen-tac-va-schema.md) · [Mục lục](../README.md) · [Bài sau →](03-xu-ly-thanh-toan.md)

## Mục tiêu

`backend/pkg/payment`: interface `Gateway`, chữ ký HMAC cho webhook, và cổng giả lập diễn đúng luồng của
cổng thật.

## Bạn sẽ học

- Đặt dịch vụ bên ngoài sau interface: thay cổng không động tới phần còn lại.
- Chữ ký HMAC-SHA256 kèm mốc thời gian chống giả mạo và chống phát lại (replay).
- Vì sao so chữ ký phải dùng `hmac.Equal`.
- Dựng cổng giả lập "đủ thật": nó gọi webhook có chữ ký vào chính API.

## Viết code

### Bước 1: Interface, `backend/pkg/payment/payment.go`

```go
// Package payment: giao diện chung cho cổng thanh toán (VNPay, MoMo, ZaloPay…).
//
// Phần còn lại của hệ thống (internal/payment) chỉ biết interface Gateway. Gắn một cổng thật là viết
// thêm MỘT adapter (tạo link thanh toán, kiểm tra chữ ký webhook, hỏi trạng thái giao dịch); bảng
// payments, xử lý webhook, đối soát, trang kết quả không phải sửa.
package payment

import (
	"context"
	"errors"
	"net/http"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
)

// Event: kết quả của một giao dịch do cổng báo về (webhook) hoặc do ta hỏi (đối soát).
type Event struct {
	// ID duy nhất của sự kiện. Cổng gửi lại cùng sự kiện (retry) thì ID giữ nguyên; dùng nó để không
	// xử lý hai lần.
	ID          string
	PaymentCode string // mã payments.code mà ta đã gửi cho cổng
	Txn         string // mã giao dịch của cổng
	Status      Status
	Amount      int64 // số tiền cổng ghi nhận (đồng)
}

type CheckoutRequest struct {
	PaymentCode string
	Amount      int64
	Description string
	ReturnURL   string // cổng đưa khách về đây sau khi trả (hoặc huỷ)
}

type Checkout struct {
	Txn string
	URL string // chuyển trình duyệt của khách tới đây để trả tiền
}

type Gateway interface {
	// Name: tên cổng, ghi vào payments.provider và nằm trong đường dẫn webhook.
	Name() string
	CreateCheckout(ctx context.Context, req CheckoutRequest) (Checkout, error)
	// ParseWebhook kiểm tra CHỮ KÝ rồi đọc sự kiện. Chữ ký sai trả ErrBadSignature: không ai ngoài
	// cổng được phép báo "đã trả tiền".
	ParseWebhook(h http.Header, body []byte) (Event, error)
	// Query hỏi cổng trạng thái hiện tại của giao dịch (đối soát khi mất webhook).
	Query(ctx context.Context, txn string) (Event, error)
}

var (
	ErrBadSignature = errors.New("chữ ký webhook không hợp lệ")
	ErrBadPayload   = errors.New("nội dung webhook không hợp lệ")
)
```

Gắn VNPay sau này là viết **một** file adapter thoả bốn hàm này: tạo link thanh toán, kiểm tra chữ ký
webhook (mỗi cổng ký kiểu riêng), hỏi trạng thái giao dịch. Bảng `payments`, xử lý webhook, đối soát,
giao diện không đổi.

### Bước 2: Chữ ký, `backend/pkg/payment/signature.go`

```go
package payment

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// HeaderSignature: "t=<giây Unix>,v1=<hex HMAC-SHA256>".
const HeaderSignature = "X-Payment-Signature"

// Chữ ký ký lên "<t>.<nội dung>" bằng khoá bí mật chung giữa ta và cổng. Hai việc:
//   - HMAC: người ngoài không có khoá thì không tạo được chữ ký đúng, nên không tự "báo đã trả tiền".
//   - Mốc thời gian nằm TRONG phần được ký, và bị từ chối nếu lệch quá 5 phút: kẻ nghe lén chép lại
//     một webhook thật rồi gửi lại sau đó (replay) sẽ bị chặn.
const maxSkew = 5 * time.Minute

// Sign tạo giá trị header cho body, dùng bởi cổng giả lập (cổng thật tự ký theo cách của họ).
func Sign(secret string, at time.Time, body []byte) string {
	t := strconv.FormatInt(at.Unix(), 10)
	return fmt.Sprintf("t=%s,v1=%s", t, mac(secret, t, body))
}

func mac(secret, t string, body []byte) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(t))
	h.Write([]byte("."))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// Verify kiểm tra header chữ ký của body.
func Verify(secret string, h http.Header, body []byte, now time.Time) error {
	var t, v1 string
	for part := range strings.SplitSeq(h.Get(HeaderSignature), ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			t = v
		case "v1":
			v1 = v
		}
	}
	sec, err := strconv.ParseInt(t, 10, 64)
	if err != nil || v1 == "" {
		return ErrBadSignature
	}
	if d := now.Sub(time.Unix(sec, 0)); d > maxSkew || d < -maxSkew {
		return ErrBadSignature
	}
	// hmac.Equal so sánh trong thời gian không phụ thuộc nội dung: so bằng == thì kẻ tấn công đo
	// thời gian trả lời để đoán dần từng ký tự của chữ ký.
	if !hmac.Equal([]byte(v1), []byte(mac(secret, t, body))) {
		return ErrBadSignature
	}
	return nil
}
```

Header `X-Payment-Signature: t=<giây Unix>,v1=<hex>`; chữ ký là HMAC-SHA256 của `"<t>.<nội dung>"`.

- **Vì sao có HMAC**: chỉ ta và cổng biết khoá. Người ngoài gửi `{"status":"succeeded"}` tới webhook
  thì không có chữ ký đúng, bị từ chối. Thiếu bước này, ai cũng "tự trả tiền" cho đơn của mình được.
- **Vì sao mốc thời gian nằm trong phần được ký**: kẻ nghe lén chép lại một webhook thật rồi gửi lại
  (replay). Chữ ký vẫn đúng, nhưng mốc thời gian quá cũ (lệch hơn 5 phút) bị từ chối. Sửa mốc thời gian
  thì chữ ký sai.
- **`hmac.Equal`**: so sánh trong thời gian không phụ thuộc nội dung. So bằng `==` dừng ở ký tự đầu
  tiên khác nhau; kẻ tấn công đo thời gian trả lời để đoán dần từng ký tự (timing attack).
- Chữ ký tính trên **đúng các byte** cổng gửi. Giải mã JSON rồi mã hoá lại có thể đổi thứ tự khoá,
  khoảng trắng, làm chữ ký sai (bài 9.04 đọc nguyên văn body).

### Bước 3: Cổng giả lập, `backend/pkg/payment/fake.go`

```go
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
```

Luồng của một cổng thật, được diễn lại:

1. `CreateCheckout` tạo phiên (lưu Redis 24 giờ), trả link tới trang của cổng (`/thanh-toan-gia-lap/<txn>`).
2. Khách bấm nút ở trang đó → `Complete` đổi trạng thái phiên rồi **gọi webhook về API, có ký HMAC**, đúng
   như VNPay làm.
3. Cổng đưa khách về `return_url`. Webhook và việc đưa khách về là **hai đường độc lập**.

Chi tiết đáng đọc:

- **`HSetNX(... "settled" ...)`**: bấm "thanh toán" hai lần ở trang cổng thì lần hai không gửi webhook thứ hai.
- **Gọi webhook lỗi vẫn đưa khách về**: đúng như thật. Cổng thật sẽ gửi lại webhook sau; cổng giả lập
  không, nên việc đối soát (bài 9.04) mới là thứ cứu trường hợp này.
- **`Query` trả `Event` có ID kèm trạng thái** (`query:<txn>:succeeded`): kết quả đối soát "đã trả" và
  "chưa trả" là hai sự kiện khác nhau, không bị chặn bởi bảng `payment_events`.

## Kiểm tra

```bash
cd backend && go build ./pkg/payment/
```

Thử chữ ký bằng `openssl` (cùng công thức với `Sign`):

```bash
SECRET=$(grep '^PAYMENT_WEBHOOK_SECRET=' backend/.env | cut -d= -f2)
T=$(date +%s); BODY='{"x":1}'
printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Chữ ký luôn sai dù đúng khoá | Chữ ký tính trên body đã bị đọc lại/định dạng lại; phải dùng nguyên byte của request |
| Đúng chữ ký nhưng vẫn bị từ chối | Đồng hồ máy chủ lệch quá 5 phút so với cổng (mốc thời gian nằm trong phần được ký); đồng bộ giờ máy chủ (NTP) |
