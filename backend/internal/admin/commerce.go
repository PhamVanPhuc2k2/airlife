package admin

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

// ---- Đơn hàng ----

type OrderRow struct {
	Code           string    `json:"code"`
	Status         string    `json:"status"`
	DeliveryMethod string    `json:"delivery_method"`
	Recipient      string    `json:"recipient_name"`
	Phone          string    `json:"phone"`
	Total          int64     `json:"total"`
	CreatedAt      time.Time `json:"created_at"`
}

func (s *Service) Orders(ctx context.Context, status, q string, p Paging) (Page[OrderRow], error) {
	rows, err := s.q.AdminListOrders(ctx, db.AdminListOrdersParams{Status: status, Q: q, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[OrderRow]{}, err
	}
	var total int64
	out := make([]OrderRow, 0, len(rows))
	for _, r := range rows {
		total = r.TotalRows
		out = append(out, OrderRow{
			Code: r.Code, Status: r.Status, DeliveryMethod: r.DeliveryMethod,
			Recipient: r.RecipientName, Phone: r.Phone, Total: r.Total, CreatedAt: r.CreatedAt,
		})
	}
	return newPage(out, total, p), nil
}

type OrderItem struct {
	Name     string `json:"product_name"`
	Variant  string `json:"variant_label"`
	Price    int64  `json:"unit_price"`
	Quantity int32  `json:"quantity"`
	Line     int64  `json:"line_total"`
}

type OrderDetail struct {
	OrderRow
	Email       string      `json:"email"`
	Customer    string      `json:"customer"`
	FlightCode  *string     `json:"flight_code"`
	FlightDate  *string     `json:"flight_date"`
	Address     *string     `json:"address"`
	Note        string      `json:"note"`
	Subtotal    int64       `json:"subtotal"`
	ShippingFee int64       `json:"shipping_fee"`
	Items       []OrderItem `json:"items"`
	Next        []string    `json:"next"` // các trạng thái có thể chuyển tới
}

// Chuyển trạng thái hợp lệ. Huỷ được khi chưa giao; completed và cancelled là cuối.
var transitions = map[string][]string{
	"pending":    {"confirmed", "cancelled"},
	"confirmed":  {"delivering", "cancelled"},
	"delivering": {"completed"},
}

func (s *Service) Order(ctx context.Context, code string) (OrderDetail, error) {
	o, err := s.q.AdminGetOrder(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrderDetail{}, errNotFound
	}
	if err != nil {
		return OrderDetail{}, err
	}
	items, err := s.q.ListOrderItems(ctx, o.ID)
	if err != nil {
		return OrderDetail{}, err
	}
	d := OrderDetail{
		OrderRow: OrderRow{
			Code: o.Code, Status: o.Status, DeliveryMethod: o.DeliveryMethod, Recipient: o.RecipientName,
			Phone: o.Phone, Total: o.Total, CreatedAt: o.CreatedAt,
		},
		Email: o.Email, Customer: o.DisplayName, FlightCode: o.FlightCode, Address: o.Address, Note: o.Note,
		Subtotal: o.Subtotal, ShippingFee: o.ShippingFee, Items: make([]OrderItem, 0, len(items)), Next: transitions[o.Status],
	}
	if o.FlightDate != nil {
		v := o.FlightDate.Format("2006-01-02")
		d.FlightDate = &v
	}
	for _, it := range items {
		d.Items = append(d.Items, OrderItem{
			Name: it.ProductName, Variant: it.VariantLabel, Price: it.UnitPrice,
			Quantity: it.Quantity, Line: it.LineTotal,
		})
	}
	return d, nil
}

// TransitionOrder đổi trạng thái đơn. Huỷ thì trả hàng về kho và trừ lại số đã bán (như khách tự huỷ).
func (s *Service) TransitionOrder(ctx context.Context, actor auth.Actor, code, to string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		o, err := q.AdminGetOrder(ctx, code)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		allowed := false
		for _, n := range transitions[o.Status] {
			allowed = allowed || n == to
		}
		if !allowed {
			return apperr.Conflict("invalid_transition", "Không thể chuyển đơn từ “"+o.Status+"” sang “"+to+"”")
		}
		id, err := q.AdminTransitionOrder(ctx, db.AdminTransitionOrderParams{Code: code, FromStatus: o.Status, ToStatus: to})
		if errors.Is(err, pgx.ErrNoRows) {
			return errStale
		}
		if err != nil {
			return err
		}
		if to == "cancelled" {
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
		}
		return s.audit(ctx, q, actor, "order."+to, "order", code, map[string]any{"from": o.Status})
	})
}

// ---- Hoàn tiền ----

type RefundRow struct {
	Code          string     `json:"code"`
	Amount        int64      `json:"amount"`
	Provider      string     `json:"provider"`
	Reason        *string    `json:"reason"`
	Pending       bool       `json:"pending"`
	RefundedAt    *time.Time `json:"refunded_at"`
	Note          *string    `json:"note"`
	PaidAt        *time.Time `json:"paid_at"`
	BookingCode   string     `json:"booking_code"`
	Product       string     `json:"product_name"`
	BookingStatus string     `json:"booking_status"`
	Email         string     `json:"email"`
	Customer      string     `json:"customer"`
}

// Refunds: filter "pending" (cần hoàn) hoặc "done" (đã hoàn).
func (s *Service) Refunds(ctx context.Context, filter string, p Paging) (Page[RefundRow], error) {
	rows, err := s.q.AdminListRefunds(ctx, db.AdminListRefundsParams{Filter: filter, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[RefundRow]{}, err
	}
	var total int64
	out := make([]RefundRow, 0, len(rows))
	for _, r := range rows {
		total = r.Total
		out = append(out, RefundRow{
			Code: r.Code, Amount: r.Amount, Provider: r.Provider, Reason: r.FailureReason,
			Pending: r.RefundRequired, RefundedAt: r.RefundedAt, Note: r.RefundNote, PaidAt: r.PaidAt,
			BookingCode: r.BookingCode, Product: r.ProductName, BookingStatus: r.BookingStatus, Email: r.Email, Customer: r.DisplayName,
		})
	}
	return newPage(out, total, p), nil
}

// MarkRefunded ghi nhận nhân viên đã hoàn tiền bằng tay (qua cổng hoặc chuyển khoản). Hệ thống
// chưa tự hoàn tiền nên ghi chú bắt buộc: mã giao dịch hoàn để sau này đối chiếu.
func (s *Service) MarkRefunded(ctx context.Context, actor auth.Actor, code, note string) error {
	note = strings.TrimSpace(note)
	if n := utf8.RuneCountInString(note); n < 3 || n > 500 {
		return apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").
			WithFields(map[string]string{"note": "Ghi chú từ 3 đến 500 ký tự, ví dụ mã giao dịch hoàn tiền"})
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		_, err := q.AdminMarkRefunded(ctx, db.AdminMarkRefundedParams{Code: code, By: &actor.UserID, Note: &note})
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.Conflict("not_refundable", "Khoản này không cần hoàn tiền hoặc đã được hoàn")
		}
		if err != nil {
			return err
		}
		return s.audit(ctx, q, actor, "payment.refunded", "payment", code, map[string]any{"note": note})
	})
}

// ---- Người dùng ----

type UserRow struct {
	ID            uuid.UUID  `json:"id"`
	Email         string     `json:"email"`
	DisplayName   string     `json:"display_name"`
	Role          string     `json:"role"`
	Status        string     `json:"status"`
	EmailVerified bool       `json:"email_verified"`
	CreatedAt     time.Time  `json:"created_at"`
	LastLoginAt   *time.Time `json:"last_login_at"`
}

func (s *Service) Users(ctx context.Context, role, q string, p Paging) (Page[UserRow], error) {
	rows, err := s.q.AdminListUsers(ctx, db.AdminListUsersParams{Role: role, Q: q, Lim: p.limit(), Off: p.offset()})
	if err != nil {
		return Page[UserRow]{}, err
	}
	var total int64
	out := make([]UserRow, 0, len(rows))
	for _, r := range rows {
		total = r.Total
		out = append(out, UserRow{
			ID: r.ID, Email: r.Email, DisplayName: r.DisplayName, Role: r.Role, Status: r.Status,
			EmailVerified: r.EmailVerifiedAt != nil, CreatedAt: r.CreatedAt, LastLoginAt: r.LastLoginAt,
		})
	}
	return newPage(out, total, p), nil
}

var roles = []string{"user", "creator", "business", "editor", "admin"}

// UpdateUser đổi vai trò / khoá tài khoản. Không tự đổi của chính mình (tránh tự khoá mình hoặc
// hạ quyền admin cuối cùng). Khoá thì huỷ mọi phiên đăng nhập: refresh token mất hiệu lực ngay;
// access token còn sống tối đa 15 phút nhưng RequireRole đọc DB nên khu quản trị chặn tức thì.
func (s *Service) UpdateUser(ctx context.Context, actor auth.Actor, id uuid.UUID, role, status string) error {
	if !contains(roles, role) {
		return apperr.Invalid("invalid_role", "Vai trò không hợp lệ")
	}
	if status != "active" && status != "locked" {
		return apperr.Invalid("invalid_status", "Trạng thái chỉ nhận active hoặc locked")
	}
	if id == actor.UserID {
		return apperr.Forbidden("self_change", "Bạn không thể đổi vai trò hoặc khoá chính mình")
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		u, err := q.AdminGetUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if _, err := q.AdminUpdateUser(ctx, db.AdminUpdateUserParams{ID: id, Role: role, Status: status}); err != nil {
			return err
		}
		return s.audit(ctx, q, actor, "user.update", "user", id.String(),
			map[string]any{"role": map[string]string{"from": u.Role, "to": role}, "status": map[string]string{"from": u.Status, "to": status}})
	})
	if err != nil {
		return err
	}
	if status == "locked" {
		return s.sessions.RevokeAllForUser(ctx, id)
	}
	return nil
}
