# Bài 7.05: Module đặt hàng: trừ kho, chống đặt trùng, huỷ đơn

> [← Bài trước](04-module-gio-hang.md) · [Mục lục](../README.md) · [Bài sau →](06-noi-route-va-thu-api.md)

## Mục tiêu

`backend/internal/order`: đặt hàng từ giỏ (COD), xem danh sách và chi tiết đơn, huỷ đơn. Đặt xong gửi email
xác nhận qua hàng đợi.

## Bạn sẽ học

- Một transaction cho cả việc đặt hàng: trừ kho, tạo đơn, chép dòng đơn, xoá giỏ.
- Idempotency key: bấm "Đặt hàng" hai lần vẫn chỉ một đơn, kể cả khi hai request chạy song song.
- Gửi email **sau** khi commit.
- Kiểm tra dữ liệu theo điều kiện (cách nhận hàng nào cần trường nào), trả lỗi theo từng ô.
- Mã đơn cho người đọc.

## Viết code

### Bước 1: Email xác nhận đơn

Email đơn hàng cần một **danh sách** (các dòng đơn), mà `mail.Job.Data` đang là `map[string]string`. Đổi
thành `map[string]any` trong `backend/internal/mail/mail.go`, thêm mẫu mới. Bản đầy đủ:

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
```

Hai chỗ tạo `mail.Job` trong `backend/internal/auth/email.go` đổi `map[string]string{` thành
`map[string]any{`. Job đang nằm trong hàng đợi (JSON) vẫn đọc được với kiểu mới.

`backend/internal/mail/templates/order_created.html`:

```html
{{template "header"}}
        <tr><td style="font-size:16px;line-height:1.6">
          Chào {{.name}},<br><br>
          Airlife đã nhận đơn hàng <b>{{.code}}</b>. Bạn thanh toán khi nhận hàng ({{.delivery}}).
        </td></tr>
        <tr><td style="padding:16px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
            {{range .items}}
            <tr>
              <td style="padding:6px 0">{{.name}} <span style="color:#64748b">({{.label}}) × {{.quantity}}</span></td>
              <td align="right" style="padding:6px 0;white-space:nowrap">{{.line_total}}</td>
            </tr>
            {{end}}
            <tr><td style="padding:6px 0;color:#64748b">Phí giao hàng</td><td align="right" style="padding:6px 0">{{.shipping}}</td></tr>
            <tr><td style="padding:8px 0;font-weight:bold;border-top:1px solid #e2e8f0">Tổng cộng</td>
                <td align="right" style="padding:8px 0;font-weight:bold;border-top:1px solid #e2e8f0">{{.total}}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="{{.link}}" style="display:inline-block;background:#6c3c8b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">Xem đơn hàng</a>
        </td></tr>
{{template "footer"}}
```

`backend/internal/mail/templates/order_created.txt`:

```text
Chào {{.name}},

Airlife đã nhận đơn hàng {{.code}}. Bạn thanh toán khi nhận hàng ({{.delivery}}).
{{range .items}}
- {{.name}} ({{.label}}) × {{.quantity}}: {{.line_total}}{{end}}

Phí giao hàng: {{.shipping}}
Tổng cộng: {{.total}}

Xem đơn hàng: {{.link}}

Airlife – Đời sống hàng không
```

Trong `{{range .items}}`, `.` là từng dòng đơn; ra khỏi `range` thì `.` lại là dữ liệu gốc. Dòng đơn dùng
khoá `line_total`, tổng đơn dùng `total`, không trùng tên cho dễ đọc.

### Bước 2: `backend/internal/order/order.go`

```go
// Package order: đặt hàng từ giỏ, xem và huỷ đơn. Thanh toán khi nhận hàng (COD); thanh toán
// online thêm ở Phần 09.
package order

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/cart"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	pageSize = 20
	// Giao tận nhà: 30.000₫, miễn phí cho đơn từ 300.000₫ (theo mockup). Các cách khác miễn phí.
	homeShippingFee    = 30_000
	freeShippingFrom   = 300_000
	ordersPerHour      = 10                                // chặn đặt đơn rác hàng loạt (COD không mất tiền nên dễ bị phá)
	codeAlphabet       = "23456789ABCDEFGHJKMNPQRSTUVWXYZ" // bỏ 0/O, 1/I/L: đọc qua điện thoại không nhầm
	codeLength         = 8
	maxIdempotencyKey  = 100
	minIdempotencyKey  = 8
	maxFlightDaysAhead = 365
)

// Tên cách nhận hàng (email, trang đơn hàng)
var DeliveryLabel = map[string]string{
	"gate":     "Nhận tại cửa ra máy bay",
	"arrival":  "Giao tại sân bay đến",
	"home":     "Giao tận nhà",
	"evoucher": "Nhận mã điện tử qua email",
}

var (
	phoneRe  = regexp.MustCompile(`^(0|\+84)[35789]\d{8}$`)
	flightRe = regexp.MustCompile(`^[A-Z0-9]{2} ?\d{1,4}$`)
	// Giờ Việt Nam: "hôm nay" của khách, không phải của server (UTC)
	vnTime = time.FixedZone("ICT", 7*60*60)

	errNotFound     = apperr.NotFound("order_not_found", "Không tìm thấy đơn hàng")
	errEmptyCart    = apperr.Invalid("cart_empty", "Giỏ hàng đang trống")
	errCartProblem  = apperr.Conflict("cart_changed", "Giỏ hàng có sản phẩm hết hàng hoặc ngừng bán, vui lòng xem lại giỏ")
	errNoDelivery   = apperr.Conflict("no_common_delivery", "Các sản phẩm trong giỏ không có cách nhận hàng chung, vui lòng đặt thành nhiều đơn")
	errNotVerified  = apperr.Forbidden("email_not_verified", "Bạn cần xác minh email trước khi đặt hàng")
	errTooMany      = apperr.TooMany("too_many_orders", "Bạn đặt quá nhiều đơn, vui lòng thử lại sau")
	errCannotCancel = apperr.Conflict("cannot_cancel", "Đơn đã được xác nhận, không huỷ được nữa. Vui lòng liên hệ Airlife")
	errBadKey       = apperr.Invalid("invalid_idempotency_key", "Thiếu hoặc sai header Idempotency-Key")
)

// Publisher: đẩy job vào hàng đợi (queue.Publisher). Khai báo ở bên dùng như gói auth.
type Publisher interface {
	Publish(ctx context.Context, queueName string, job any) error
}

type CheckoutInput struct {
	DeliveryMethod string `json:"delivery_method"`
	RecipientName  string `json:"recipient_name"`
	Phone          string `json:"phone"`
	FlightCode     string `json:"flight_code"`
	FlightDate     string `json:"flight_date"` // "2026-11-14"
	Address        string `json:"address"`
	Note           string `json:"note"`
}

type Item struct {
	ProductSlug  string `json:"product_slug"`
	ProductName  string `json:"product_name"`
	VariantLabel string `json:"variant_label"`
	ImageURL     string `json:"image_url"`
	UnitPrice    int64  `json:"unit_price"`
	Quantity     int32  `json:"quantity"`
	LineTotal    int64  `json:"line_total"`
}

type Order struct {
	Code           string     `json:"code"`
	Status         string     `json:"status"`
	PaymentMethod  string     `json:"payment_method"`
	DeliveryMethod string     `json:"delivery_method"`
	RecipientName  string     `json:"recipient_name"`
	Phone          string     `json:"phone"`
	FlightCode     *string    `json:"flight_code"`
	FlightDate     *string    `json:"flight_date"`
	Address        *string    `json:"address"`
	Note           string     `json:"note"`
	Subtotal       int64      `json:"subtotal"`
	ShippingFee    int64      `json:"shipping_fee"`
	Total          int64      `json:"total"`
	CreatedAt      time.Time  `json:"created_at"`
	CancelledAt    *time.Time `json:"cancelled_at"`
	Items          []Item     `json:"items"`
}

// Summary: một dòng trong danh sách đơn
type Summary struct {
	Code           string    `json:"code"`
	Status         string    `json:"status"`
	DeliveryMethod string    `json:"delivery_method"`
	Total          int64     `json:"total"`
	CreatedAt      time.Time `json:"created_at"`
	FirstName      string    `json:"first_name"`
	FirstImage     string    `json:"first_image"`
	ItemCount      int64     `json:"item_count"`
}

type Page struct {
	Items      []Summary `json:"items"`
	NextCursor string    `json:"next_cursor,omitempty"`
}

type cursor struct {
	T  time.Time `json:"t"`
	ID uuid.UUID `json:"id"`
}

type Service struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	rdb       *redis.Client
	mail      Publisher
	publicURL string
	log       *slog.Logger
}

func NewService(pool *pgxpool.Pool, rdb *redis.Client, mail Publisher, publicURL string, log *slog.Logger) *Service {
	return &Service{pool: pool, q: db.New(pool), rdb: rdb, mail: mail, publicURL: publicURL, log: log}
}

// errDuplicate: request khác cùng Idempotency-Key vừa tạo đơn trước (bấm "Đặt hàng" hai lần).
var errDuplicate = errors.New("đơn trùng idempotency key")

// Checkout tạo đơn từ giỏ hàng trên server. key: header Idempotency-Key, trình duyệt sinh một lần
// cho mỗi lần mở trang thanh toán. Gọi lại với cùng key thì trả lại đúng đơn đã tạo.
func (s *Service) Checkout(ctx context.Context, userID uuid.UUID, key string, in CheckoutInput) (Order, error) {
	if n := len(key); n < minIdempotencyKey || n > maxIdempotencyKey {
		return Order{}, errBadKey
	}
	// Đã đặt với key này (lần gửi trước thành công mà trình duyệt không nhận được phản hồi)
	if code, err := s.q.GetOrderCodeByIdempotencyKey(ctx, db.GetOrderCodeByIdempotencyKeyParams{
		UserID: userID, IdempotencyKey: key,
	}); err == nil {
		return s.Get(ctx, userID, code)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Order{}, err
	}

	in, err := validate(in)
	if err != nil {
		return Order{}, err
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return Order{}, err
	}
	// COD không mất tiền trước: tài khoản rác đặt đơn giả sẽ giữ hết hàng. Bắt xác minh email và
	// giới hạn số đơn mỗi giờ.
	if user.EmailVerifiedAt == nil {
		return Order{}, errNotVerified
	}
	if err := s.rateLimit(ctx, userID); err != nil {
		return Order{}, err
	}

	var o Order
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		c, err := cart.Get(ctx, q, userID)
		if err != nil {
			return err
		}
		if len(c.Lines) == 0 {
			return errEmptyCart
		}
		if !c.Ready {
			if len(c.DeliveryMethods) == 0 && !hasProblem(c) {
				return errNoDelivery
			}
			return errCartProblem
		}
		if !slices.Contains(c.DeliveryMethods, in.DeliveryMethod) {
			return apperr.Invalid("validation_failed", "Cách nhận hàng không dùng được cho giỏ này").
				WithFields(map[string]string{"delivery_method": "Chọn một cách nhận hàng khác"})
		}

		// Trừ kho từng dòng. Một dòng hết hàng là huỷ cả transaction: các dòng đã trừ trước đó
		// được trả lại tự động (rollback), không phải tự cộng lại.
		for _, l := range c.Lines {
			n, err := q.DecrementStock(ctx, db.DecrementStockParams{ID: l.VariantID, Quantity: l.Quantity})
			if err != nil {
				return err
			}
			if n == 0 {
				return apperr.Conflict("out_of_stock",
					fmt.Sprintf("%s (%s) vừa hết hàng hoặc không còn đủ số lượng", l.Product.Name, l.Label))
			}
		}

		var shipping int64
		if in.DeliveryMethod == "home" && c.Subtotal < freeShippingFrom {
			shipping = homeShippingFee
		}
		o = Order{
			Code: newCode(), Status: "pending", PaymentMethod: "cod", DeliveryMethod: in.DeliveryMethod,
			RecipientName: in.RecipientName, Phone: in.Phone, FlightCode: nilIfEmpty(in.FlightCode),
			FlightDate: nilIfEmpty(in.FlightDate), Address: nilIfEmpty(in.Address), Note: in.Note,
			Subtotal: c.Subtotal, ShippingFee: shipping, Total: c.Subtotal + shipping,
		}
		var flightDate *time.Time
		if o.FlightDate != nil {
			d, _ := time.Parse(time.DateOnly, *o.FlightDate) // đã kiểm tra ở validate
			flightDate = &d
		}
		row, err := q.CreateOrder(ctx, db.CreateOrderParams{
			Code: o.Code, UserID: userID, DeliveryMethod: o.DeliveryMethod, RecipientName: o.RecipientName,
			Phone: o.Phone, FlightCode: o.FlightCode, FlightDate: flightDate, Address: o.Address,
			Note: o.Note, Subtotal: o.Subtotal, ShippingFee: o.ShippingFee, Total: o.Total, IdempotencyKey: key,
		})
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "orders_user_id_idempotency_key_key" {
			return errDuplicate
		}
		if err != nil {
			return err
		}
		o.CreatedAt = row.CreatedAt

		for i, l := range c.Lines {
			item := Item{
				ProductSlug: l.Product.Slug, ProductName: l.Product.Name, VariantLabel: l.Label,
				ImageURL: l.Product.ImageURL, UnitPrice: l.Price, Quantity: l.Quantity,
				LineTotal: l.Price * int64(l.Quantity),
			}
			o.Items = append(o.Items, item)
			variantID := l.VariantID
			if err := q.CreateOrderItem(ctx, db.CreateOrderItemParams{
				OrderID: row.ID, VariantID: &variantID, ProductSlug: item.ProductSlug,
				ProductName: item.ProductName, VariantLabel: item.VariantLabel, ImageUrl: item.ImageURL,
				UnitPrice: item.UnitPrice, Quantity: item.Quantity, LineTotal: item.LineTotal,
				Position: int16(i), //nolint:gosec // giỏ tối đa 50 dòng
			}); err != nil {
				return err
			}
			if err := q.AddProductSold(ctx, db.AddProductSoldParams{Delta: l.Quantity, VariantID: l.VariantID}); err != nil {
				return err
			}
		}
		return q.ClearCart(ctx, userID)
	})
	if errors.Is(err, errDuplicate) {
		// Hai request cùng key chạy song song: request kia đã tạo đơn, trả lại đơn đó
		code, err := s.q.GetOrderCodeByIdempotencyKey(ctx, db.GetOrderCodeByIdempotencyKeyParams{
			UserID: userID, IdempotencyKey: key,
		})
		if err != nil {
			return Order{}, err
		}
		return s.Get(ctx, userID, code)
	}
	if err != nil {
		return Order{}, err
	}

	// Gửi mail SAU khi commit: transaction lỗi thì không gửi thư cho đơn không tồn tại. Gửi lỗi
	// không làm hỏng việc đặt hàng (đơn đã có, khách xem được ở trang Đơn hàng).
	if err := s.sendCreatedEmail(ctx, user.Email, user.DisplayName, o); err != nil {
		s.log.ErrorContext(ctx, "không đẩy được email đơn hàng", "code", o.Code, "err", err)
	}
	return o, nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, cursorStr string) (Page, error) {
	var c cursor
	has, err := pagination.Decode(cursorStr, &c)
	if err != nil {
		return Page{}, err
	}
	arg := db.ListOrdersParams{UserID: userID, Limit: pageSize + 1}
	if has {
		arg.CursorTime, arg.CursorID = &c.T, &c.ID
	}
	rows, err := s.q.ListOrders(ctx, arg)
	if err != nil {
		return Page{}, err
	}
	p := Page{Items: make([]Summary, 0, len(rows))}
	for i, r := range rows {
		if i == pageSize {
			last := rows[pageSize-1]
			p.NextCursor = pagination.Encode(cursor{T: last.CreatedAt, ID: last.ID})
			break
		}
		p.Items = append(p.Items, Summary{
			Code: r.Code, Status: r.Status, DeliveryMethod: r.DeliveryMethod, Total: r.Total,
			CreatedAt: r.CreatedAt, FirstName: r.FirstName, FirstImage: r.FirstImage, ItemCount: r.ItemCount,
		})
	}
	return p, nil
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID, code string) (Order, error) {
	r, err := s.q.GetOrder(ctx, db.GetOrderParams{UserID: userID, Code: code})
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, errNotFound
	}
	if err != nil {
		return Order{}, err
	}
	o := Order{
		Code: r.Code, Status: r.Status, PaymentMethod: r.PaymentMethod, DeliveryMethod: r.DeliveryMethod,
		RecipientName: r.RecipientName, Phone: r.Phone, FlightCode: r.FlightCode, Address: r.Address,
		Note: r.Note, Subtotal: r.Subtotal, ShippingFee: r.ShippingFee, Total: r.Total,
		CreatedAt: r.CreatedAt, CancelledAt: r.CancelledAt,
	}
	if r.FlightDate != nil {
		d := r.FlightDate.Format(time.DateOnly)
		o.FlightDate = &d
	}
	items, err := s.q.ListOrderItems(ctx, r.ID)
	if err != nil {
		return Order{}, err
	}
	o.Items = make([]Item, 0, len(items))
	for _, it := range items {
		o.Items = append(o.Items, Item{
			ProductSlug: it.ProductSlug, ProductName: it.ProductName, VariantLabel: it.VariantLabel,
			ImageURL: it.ImageUrl, UnitPrice: it.UnitPrice, Quantity: it.Quantity, LineTotal: it.LineTotal,
		})
	}
	return o, nil
}

// Cancel: khách tự huỷ khi đơn còn "chờ xác nhận". Trả hàng về kho, trừ lại số đã bán.
func (s *Service) Cancel(ctx context.Context, userID uuid.UUID, code string) (Order, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		id, err := q.CancelOrder(ctx, db.CancelOrderParams{UserID: userID, Code: code})
		if errors.Is(err, pgx.ErrNoRows) {
			// Không có đơn, hoặc có nhưng không còn ở "chờ xác nhận"
			if _, err := q.GetOrder(ctx, db.GetOrderParams{UserID: userID, Code: code}); errors.Is(err, pgx.ErrNoRows) {
				return errNotFound
			}
			return errCannotCancel
		}
		if err != nil {
			return err
		}
		if err := q.RestockOrder(ctx, id); err != nil {
			return err
		}
		lines, err := q.ListOrderVariantQuantities(ctx, id)
		if err != nil {
			return err
		}
		for _, l := range lines {
			if err := q.AddProductSold(ctx, db.AddProductSoldParams{Delta: -l.Quantity, VariantID: *l.VariantID}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Order{}, err
	}
	return s.Get(ctx, userID, code)
}

func (s *Service) sendCreatedEmail(ctx context.Context, to, name string, o Order) error {
	items := make([]map[string]any, 0, len(o.Items))
	for _, it := range o.Items {
		items = append(items, map[string]any{
			"name": it.ProductName, "label": it.VariantLabel, "quantity": it.Quantity,
			"line_total": FormatVND(it.LineTotal),
		})
	}
	return s.mail.Publish(ctx, mail.Queue, mail.Job{
		Template: mail.TemplateOrderCreated,
		To:       to,
		Data: map[string]any{
			"name": name, "code": o.Code, "delivery": DeliveryLabel[o.DeliveryMethod], "items": items,
			"shipping": FormatVND(o.ShippingFee), "total": FormatVND(o.Total),
			"link": s.publicURL + "/don-hang/" + o.Code,
		},
	})
}

func (s *Service) rateLimit(ctx context.Context, userID uuid.UUID) error {
	key := "order:rate:" + userID.String()
	pipe := s.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}
	if incr.Val() > ordersPerHour {
		return errTooMany
	}
	return nil
}

// validate kiểm tra và chuẩn hoá thông tin nhận hàng. Lỗi trả theo từng ô của form.
func validate(in CheckoutInput) (CheckoutInput, error) {
	fields := map[string]string{}
	in.RecipientName = strings.TrimSpace(in.RecipientName)
	in.Phone = strings.NewReplacer(" ", "", ".", "", "-", "").Replace(in.Phone)
	in.FlightCode = strings.ToUpper(strings.TrimSpace(in.FlightCode))
	in.FlightDate = strings.TrimSpace(in.FlightDate)
	in.Address = strings.TrimSpace(in.Address)
	in.Note = strings.TrimSpace(in.Note)

	if _, ok := DeliveryLabel[in.DeliveryMethod]; !ok {
		fields["delivery_method"] = "Chọn cách nhận hàng"
	}
	if n := utf8.RuneCountInString(in.RecipientName); n < 2 || n > 100 {
		fields["recipient_name"] = "Họ tên từ 2 đến 100 ký tự"
	}
	if !phoneRe.MatchString(in.Phone) {
		fields["phone"] = "Số điện thoại Việt Nam không hợp lệ"
	}
	if utf8.RuneCountInString(in.Note) > 500 {
		fields["note"] = "Ghi chú tối đa 500 ký tự"
	}
	switch in.DeliveryMethod {
	case "gate", "arrival":
		if !flightRe.MatchString(in.FlightCode) {
			fields["flight_code"] = "Số hiệu chuyến bay, VD: VN 220"
		}
		d, err := time.ParseInLocation(time.DateOnly, in.FlightDate, vnTime)
		now := time.Now().In(vnTime)
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, vnTime)
		if err != nil || d.Before(today) || d.After(today.AddDate(0, 0, maxFlightDaysAhead)) {
			fields["flight_date"] = "Ngày bay từ hôm nay đến 1 năm tới"
		}
		in.Address = ""
	case "home":
		if n := utf8.RuneCountInString(in.Address); n < 10 || n > 300 {
			fields["address"] = "Địa chỉ từ 10 đến 300 ký tự"
		}
		in.FlightCode, in.FlightDate = "", ""
	default: // evoucher: không cần gì thêm
		in.FlightCode, in.FlightDate, in.Address = "", "", ""
	}
	if len(fields) > 0 {
		return in, apperr.Invalid("validation_failed", "Thông tin nhận hàng chưa hợp lệ").WithFields(fields)
	}
	return in, nil
}

func hasProblem(c cart.Cart) bool {
	return slices.ContainsFunc(c.Lines, func(l cart.Line) bool { return l.Problem != "" })
}

// newCode: "AL-" + 8 ký tự ngẫu nhiên (31^8 ≈ 850 tỉ mã). Trùng mã thì CreateOrder lỗi UNIQUE và
// khách bấm đặt lại; xác suất quá nhỏ để đáng viết vòng lặp thử lại.
func newCode() string {
	b := make([]byte, codeLength)
	_, _ = rand.Read(b) // crypto/rand.Read không trả lỗi trên Linux (Go ≥ 1.24 panic nếu hỏng)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return "AL-" + string(b)
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// FormatVND: 389000 → "389.000₫"
func FormatVND(n int64) string {
	s := fmt.Sprintf("%d", n)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return b.String() + "₫"
}
```

Đọc theo thứ tự trong `Checkout`:

1. **Đã có đơn với key này?** Trả lại đơn đó. Trường hợp: request đầu đã tạo đơn nhưng mạng rớt trước khi
   trình duyệt nhận phản hồi, trình duyệt gửi lại.
2. **Kiểm tra form, email đã xác minh, giới hạn 10 đơn/giờ.** COD không mất tiền trước, nên tài khoản rác
   đặt đơn giả sẽ giữ hết hàng; chặn như bình luận (bài 5.03).
3. **Trong transaction**: đọc giỏ (`cart.Get` với `db.New(tx)`), trừ kho từng dòng (bài 7.02), tạo đơn,
   chép dòng đơn, tăng "đã bán", xoá giỏ. Một dòng hết hàng là `return` lỗi: `BeginFunc` rollback, các dòng
   đã trừ trước đó tự trả lại.
4. **Hai request cùng key chạy song song**: cả hai qua bước 1 (chưa có đơn), nhưng chỉ một `INSERT` thành
   công; cái kia vấp `UNIQUE (user_id, idempotency_key)`, mã lỗi `23505`. Bắt lỗi đó (`errDuplicate`), đọc
   đơn đã có và trả về. Cùng ý tưởng với "để database chặn email trùng" ở bài 4.04.
5. **Gửi email sau commit**: gửi trong transaction mà transaction lỗi sau đó thì khách nhận thư cho một đơn
   không tồn tại.

Các phần khác:

- **`Cancel`**: điều kiện `status = 'pending'` nằm ngay trong `UPDATE ... RETURNING`, nên bấm huỷ hai lần
  thì chỉ một lần đổi được trạng thái và trả hàng về kho.
- **`validate`**: chuẩn hoá trước khi kiểm tra (bỏ dấu cách trong số điện thoại, viết hoa số hiệu chuyến
  bay `vn 220` → `VN 220`), xoá trường không dùng (giao tận nhà thì bỏ số hiệu chuyến bay).
- **"Hôm nay" theo giờ Việt Nam** (`vnTime`): server chạy giờ UTC; 6 giờ sáng ở Việt Nam vẫn là "hôm qua"
  theo UTC, khách chọn ngày bay hôm nay sẽ bị báo sai.
- **`newCode`**: bảng chữ bỏ `0/O`, `1/I/L` để đọc qua điện thoại không nhầm.
- **`Item{...}` viết tay** trong `Get`: `db.ListOrderItemsRow` có trường `ImageUrl` (sqlc đặt tên), còn
  `Item` có `ImageURL`; khác một tên trường là không đổi kiểu trực tiếp được.

### Bước 3: `backend/internal/order/handler.go`

```go
package order

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

func userID(r *http.Request) uuid.UUID {
	a, _ := auth.ActorFrom(r.Context())
	return a.UserID
}

// POST /me/orders  (header Idempotency-Key)  body: CheckoutInput
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	var in CheckoutInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	o, err := h.svc.Checkout(r.Context(), userID(r), r.Header.Get("Idempotency-Key"), in)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.Created(w, o)
}

// GET /me/orders?cursor=…
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	p, err := h.svc.List(r.Context(), userID(r), r.URL.Query().Get("cursor"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, p)
}

// GET /me/orders/{code}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	o, err := h.svc.Get(r.Context(), userID(r), chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, o)
}

// POST /me/orders/{code}/cancel
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	o, err := h.svc.Cancel(r.Context(), userID(r), chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, o)
}
```

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `make lint`: `File is not properly formatted (gofumpt)` | Căn cột các khối `const`, trường struct; chạy `make fmt` |
| Hai người cùng mua món cuối đều đặt được | Đang kiểm tra tồn kho bằng `SELECT` rồi mới `UPDATE`; dùng một câu `UPDATE ... WHERE stock >= …` |
| Bấm "Đặt hàng" hai lần ra hai đơn | Thiếu `UNIQUE (user_id, idempotency_key)`, hoặc trình duyệt sinh key mới mỗi lần bấm (bài 7.10) |
| Khách nhận email cho đơn bị lỗi | Đang gửi mail bên trong transaction |
