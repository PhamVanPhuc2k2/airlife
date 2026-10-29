// Package order: đặt hàng từ giỏ, xem và huỷ đơn. Thanh toán khi nhận hàng (COD); thanh toán
// online thêm ở Phần 09.
package order

import (
	"context"
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
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/refcode"
)

const (
	pageSize = 20
	// Giao tận nhà: 30.000₫, miễn phí cho đơn từ 300.000₫ (theo mockup). Các cách khác miễn phí.
	homeShippingFee    = 30_000
	freeShippingFrom   = 300_000
	ordersPerHour      = 10 // chặn đặt đơn rác hàng loạt (COD không mất tiền nên dễ bị phá)
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
			Code: refcode.New("AL-"), Status: "pending", PaymentMethod: "cod", DeliveryMethod: in.DeliveryMethod,
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
