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
