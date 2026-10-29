# Bài 8.02: Module đặt chỗ: lịch khởi hành, giữ chỗ 20 phút

> [← Bài trước](01-schema-va-lich-khoi-hanh.md) · [Mục lục](../README.md) · [Bài sau →](03-hanh-khach-va-huy.md)

## Mục tiêu

- `GET /products/{slug}/departures`: hạng dịch vụ và lịch khởi hành kèm số chỗ còn.
- `POST /me/bookings`: giữ chỗ (lấy ghế + tạo đơn "held" hết hạn sau 20 phút), có khoá chống trùng.
- Tách hàm sinh mã đơn thành gói dùng chung.

## Bạn sẽ học

- Chống "xí chỗ": giới hạn số đơn đang giữ của mỗi người.
- Báo lỗi đủ ý: "hết chỗ" khác "chỉ còn 1 chỗ".
- Gom các dòng (ngày, hạng) thành danh sách ngày, mỗi ngày nhiều hạng.
- Thấy hai chỗ cùng một đoạn code thì tách ra gói chung.

## Viết code

### Bước 1: Mã cho người đọc, `backend/pkg/refcode/refcode.go`

Mã đặt chỗ `BK-…` sinh giống hệt mã đơn hàng `AL-…` (bài 7.05). Thay vì chép, tách thành gói chung:

```go
// Package refcode sinh mã cho người đọc: mã đơn hàng (AL-7KQ2M9XA), mã đặt chỗ (BK-…).
package refcode

import "crypto/rand"

// Bỏ 0/O, 1/I/L: khách đọc mã qua điện thoại không nhầm
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// New: prefix + 8 ký tự ngẫu nhiên (31^8 ≈ 850 tỉ mã). Cột mã có UNIQUE; trùng thì lệnh INSERT lỗi
// và khách thử lại, xác suất quá nhỏ để đáng viết vòng lặp thử lại.
func New(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read không trả lỗi (Go ≥ 1.24 dừng chương trình nếu hỏng)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return prefix + string(b)
}
```

Trong `backend/internal/order/order.go`: xoá hằng `codeAlphabet`, `codeLength`, hàm `newCode` và import
`crypto/rand`; tạo đơn dùng `refcode.New("AL-")`.

### Bước 2: `backend/internal/booking/booking.go`

Cả bài này và bài 8.03 nằm trong file này:

```go
// Package booking: đặt vé bay, tour. Chọn ngày khởi hành, hạng dịch vụ, số khách → giữ chỗ 20 phút
// → điền hành khách → chờ thanh toán (Phần 09). Quá hạn thì worker trả ghế (ExpireDue).
package booking

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/refcode"
)

const (
	HoldDuration   = 20 * time.Minute
	maxActiveHolds = 2 // đơn đang giữ chỗ / người
	maxPassengers  = 9
	pageSize       = 20
	childMinAge    = 2
	adultMinAge    = 12
)

var (
	slugRe   = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	phoneRe  = regexp.MustCompile(`^(0|\+84)[35789]\d{8}$`) // như internal/order
	nameRe   = regexp.MustCompile(`^[A-Z]+( [A-Z]+)+$`)     // ít nhất họ và tên
	spacesRe = regexp.MustCompile(`\s+`)
	vnTime   = time.FixedZone("ICT", 7*60*60)

	errNotFound     = apperr.NotFound("booking_not_found", "Không tìm thấy đơn đặt chỗ")
	errNoDeparture  = apperr.NotFound("departure_not_found", "Không tìm thấy chuyến khởi hành")
	errClosed       = apperr.Conflict("departure_closed", "Chuyến này đã đóng đặt chỗ")
	errNotVerified  = apperr.Forbidden("email_not_verified", "Bạn cần xác minh email trước khi đặt chỗ")
	errTooManyHolds = apperr.Conflict("too_many_holds",
		"Bạn đang giữ chỗ 2 đơn chưa thanh toán. Hoàn tất hoặc huỷ bớt rồi đặt tiếp")
	errNotActive = apperr.Conflict("booking_not_active", "Đơn đã hết thời gian giữ chỗ hoặc đã huỷ")
	errBadKey    = apperr.Invalid("invalid_idempotency_key", "Thiếu hoặc sai header Idempotency-Key")
	errDuplicate = errors.New("đơn trùng idempotency key")
)

// --- Lịch khởi hành --------------------------------------------------------------------------

type Fare struct {
	ID          uuid.UUID `json:"id"`
	Code        string    `json:"code"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	AdultPrice  int64     `json:"adult_price"`
	ChildPrice  int64     `json:"child_price"`
}

type Seats struct {
	FareID uuid.UUID `json:"fare_id"`
	Left   int32     `json:"left"`
}

type Departure struct {
	ID         uuid.UUID `json:"id"`
	DepartDate string    `json:"depart_date"` // "2026-11-14"
	ReturnDate *string   `json:"return_date"`
	Seats      []Seats   `json:"seats"`
}

type Availability struct {
	Fares      []Fare      `json:"fares"`
	Departures []Departure `json:"departures"`
}

// --- Đơn đặt chỗ -----------------------------------------------------------------------------

type HoldInput struct {
	DepartureID uuid.UUID `json:"departure_id"`
	FareID      uuid.UUID `json:"fare_id"`
	Adults      int16     `json:"adults"`
	Children    int16     `json:"children"`
}

type PassengerInput struct {
	FullName  string `json:"full_name"`
	BirthDate string `json:"birth_date"` // "1990-05-20"
}

type DetailsInput struct {
	ContactName  string           `json:"contact_name"`
	ContactPhone string           `json:"contact_phone"`
	ContactEmail string           `json:"contact_email"`
	Passengers   []PassengerInput `json:"passengers"`
}

type Passenger struct {
	Kind      string `json:"kind"` // adult | child
	FullName  string `json:"full_name"`
	BirthDate string `json:"birth_date"`
}

type Contact struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email"`
}

type Product struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Tag      string `json:"tag"`
	ImageURL string `json:"image_url"`
}

type Booking struct {
	Code      string    `json:"code"`
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
	// Số giây giữ chỗ còn lại, tính ở SERVER: đồng hồ máy khách có thể lệch vài phút, đếm ngược
	// theo expires_at với giờ máy khách sẽ sai. Trình duyệt đếm ngược từ con số này.
	ExpiresIn  int64       `json:"expires_in"`
	Product    Product     `json:"product"`
	FareLabel  string      `json:"fare_label"`
	DepartDate string      `json:"depart_date"`
	ReturnDate *string     `json:"return_date"`
	Adults     int16       `json:"adults"`
	Children   int16       `json:"children"`
	AdultPrice int64       `json:"adult_price"`
	ChildPrice int64       `json:"child_price"`
	Total      int64       `json:"total"`
	Contact    *Contact    `json:"contact"`
	Passengers []Passenger `json:"passengers"`
	CreatedAt  time.Time   `json:"created_at"`
}

type Summary struct {
	Code         string    `json:"code"`
	Status       string    `json:"status"`
	ExpiresAt    time.Time `json:"expires_at"`
	ProductName  string    `json:"product_name"`
	ProductImage string    `json:"product_image"`
	FareLabel    string    `json:"fare_label"`
	DepartDate   string    `json:"depart_date"`
	Adults       int16     `json:"adults"`
	Children     int16     `json:"children"`
	Total        int64     `json:"total"`
	CreatedAt    time.Time `json:"created_at"`
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
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: db.New(pool)}
}

// tomorrow: ngày sớm nhất còn đặt được (chốt trước một ngày), theo giờ Việt Nam
func tomorrow() time.Time {
	now := time.Now().In(vnTime)
	return time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
}

func dateStr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.DateOnly)
	return &s
}

// Availability: hạng dịch vụ và lịch khởi hành (kèm số chỗ còn) của một sản phẩm vé/tour.
func (s *Service) Availability(ctx context.Context, slug string) (Availability, error) {
	if !slugRe.MatchString(slug) {
		return Availability{}, errNoDeparture
	}
	fares, err := s.q.ListProductFares(ctx, slug)
	if err != nil {
		return Availability{}, err
	}
	if len(fares) == 0 {
		return Availability{}, apperr.NotFound("product_not_found", "Không tìm thấy vé, tour này")
	}
	a := Availability{Fares: make([]Fare, 0, len(fares)), Departures: []Departure{}}
	for _, f := range fares {
		a.Fares = append(a.Fares, Fare(f))
	}
	rows, err := s.q.ListDepartureSeats(ctx, db.ListDepartureSeatsParams{Slug: slug, FromDate: tomorrow()})
	if err != nil {
		return Availability{}, err
	}
	// Mỗi dòng là một (ngày, hạng), đã sắp theo ngày: gom các hạng của cùng ngày lại
	for _, r := range rows {
		if n := len(a.Departures); n == 0 || a.Departures[n-1].ID != r.DepartureID {
			a.Departures = append(a.Departures, Departure{
				ID: r.DepartureID, DepartDate: r.DepartDate.Format(time.DateOnly), ReturnDate: dateStr(r.ReturnDate),
			})
		}
		d := &a.Departures[len(a.Departures)-1]
		d.Seats = append(d.Seats, Seats{FareID: r.FareID, Left: r.SeatsLeft})
	}
	return a, nil
}

// Hold giữ chỗ: lấy ghế và tạo đơn "held" hết hạn sau 20 phút. key: header Idempotency-Key.
func (s *Service) Hold(ctx context.Context, userID uuid.UUID, key string, in HoldInput) (Booking, error) {
	if n := len(key); n < 8 || n > 100 {
		return Booking{}, errBadKey
	}
	if code, err := s.q.GetBookingCodeByIdempotencyKey(ctx, db.GetBookingCodeByIdempotencyKeyParams{
		UserID: userID, IdempotencyKey: key,
	}); err == nil {
		return s.Get(ctx, userID, code)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Booking{}, err
	}

	if in.Adults < 1 || in.Children < 0 || in.Adults+in.Children > maxPassengers {
		return Booking{}, apperr.Invalid("invalid_passengers", "Từ 1 người lớn, tối đa 9 khách mỗi đơn")
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return Booking{}, err
	}
	if user.EmailVerifiedAt == nil {
		return Booking{}, errNotVerified
	}
	// Giữ chỗ không mất tiền: không giới hạn thì một người giữ hết chỗ của một chuyến rồi bỏ đó
	// (đối thủ phá, hoặc "xí chỗ" để bán lại). Mỗi người tối đa 2 đơn đang giữ.
	active, err := s.q.CountActiveHolds(ctx, userID)
	if err != nil {
		return Booking{}, err
	}
	if active >= maxActiveHolds {
		return Booking{}, errTooManyHolds
	}

	df, err := s.q.GetDepartureFare(ctx, db.GetDepartureFareParams{DepartureID: in.DepartureID, FareID: in.FareID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Booking{}, errNoDeparture
	}
	if err != nil {
		return Booking{}, err
	}
	if df.DepartureStatus != "open" || df.DepartDate.Before(tomorrow()) {
		return Booking{}, errClosed
	}

	seats := int32(in.Adults + in.Children)
	code := refcode.New("BK-")
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		n, err := q.TakeSeats(ctx, db.TakeSeatsParams{Seats: seats, DepartureID: df.DepartureID, FareID: df.FareID})
		if err != nil {
			return err
		}
		if n == 0 {
			left, err := q.SeatsLeft(ctx, db.SeatsLeftParams{DepartureID: df.DepartureID, FareID: df.FareID})
			if err != nil {
				return err
			}
			if left == 0 {
				return apperr.Conflict("sold_out", fmt.Sprintf("Hạng %s ngày %s đã hết chỗ",
					df.FareLabel, df.DepartDate.Format("02/01/2006")))
			}
			return apperr.Conflict("not_enough_seats", fmt.Sprintf("Hạng %s ngày %s chỉ còn %d chỗ",
				df.FareLabel, df.DepartDate.Format("02/01/2006"), left))
		}
		_, err = q.CreateBooking(ctx, db.CreateBookingParams{
			Code: code, UserID: userID, DepartureID: df.DepartureID, FareID: df.FareID,
			ExpiresAt: time.Now().Add(HoldDuration), Adults: in.Adults, Children: in.Children,
			ProductSlug: df.ProductSlug, ProductName: df.ProductName, FareLabel: df.FareLabel,
			DepartDate: df.DepartDate, ReturnDate: df.ReturnDate,
			AdultPrice: df.AdultPrice, ChildPrice: df.ChildPrice,
			Total:          df.AdultPrice*int64(in.Adults) + df.ChildPrice*int64(in.Children),
			IdempotencyKey: key,
		})
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "bookings_user_id_idempotency_key_key" {
			return errDuplicate
		}
		return err
	})
	if errors.Is(err, errDuplicate) {
		// Hai request cùng key chạy song song: ghế của request này đã được trả (rollback)
		existing, err := s.q.GetBookingCodeByIdempotencyKey(ctx, db.GetBookingCodeByIdempotencyKeyParams{
			UserID: userID, IdempotencyKey: key,
		})
		if err != nil {
			return Booking{}, err
		}
		return s.Get(ctx, userID, existing)
	}
	if err != nil {
		return Booking{}, err
	}
	return s.Get(ctx, userID, code)
}

// SetDetails lưu người liên hệ và hành khách; đơn chuyển sang "chờ thanh toán". Gọi lại được (sửa
// thông tin) khi đơn còn đang giữ chỗ. Thời hạn giữ chỗ KHÔNG được kéo dài thêm.
func (s *Service) SetDetails(ctx context.Context, userID uuid.UUID, code string, in DetailsInput) (Booking, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		b, err := q.LockBookingForUpdate(ctx, db.LockBookingForUpdateParams{UserID: userID, Code: code})
		if errors.Is(err, pgx.ErrNoRows) {
			return s.inactiveOrMissing(ctx, q, userID, code)
		}
		if err != nil {
			return err
		}
		contact, passengers, err := validateDetails(in, b.Adults, b.Children, b.DepartDate)
		if err != nil {
			return err
		}
		if err := q.DeleteBookingPassengers(ctx, b.ID); err != nil {
			return err
		}
		for i, p := range passengers {
			birth, _ := time.Parse(time.DateOnly, p.BirthDate) // đã kiểm tra ở validateDetails
			if err := q.CreateBookingPassenger(ctx, db.CreateBookingPassengerParams{
				BookingID: b.ID, Position: int16(i), Kind: p.Kind, //nolint:gosec // tối đa 9 khách
				FullName: p.FullName, BirthDate: birth,
			}); err != nil {
				return err
			}
		}
		return q.SetBookingContact(ctx, db.SetBookingContactParams{
			ID: b.ID, ContactName: &contact.Name, ContactPhone: &contact.Phone, ContactEmail: &contact.Email,
		})
	})
	if err != nil {
		return Booking{}, err
	}
	return s.Get(ctx, userID, code)
}

// Cancel: khách huỷ đơn đang giữ chỗ, ghế được trả ngay (một câu lệnh, xem bookings.sql).
func (s *Service) Cancel(ctx context.Context, userID uuid.UUID, code string) (Booking, error) {
	n, err := s.q.CancelBooking(ctx, db.CancelBookingParams{UserID: userID, Code: code})
	if err != nil {
		return Booking{}, err
	}
	if n == 0 {
		return Booking{}, s.inactiveOrMissing(ctx, s.q, userID, code)
	}
	return s.Get(ctx, userID, code)
}

// ExpireDue: worker gọi định kỳ. Trả số dòng (ngày, hạng) được trả ghế.
func (s *Service) ExpireDue(ctx context.Context) (int64, error) {
	return s.q.ExpireBookings(ctx)
}

func (s *Service) inactiveOrMissing(ctx context.Context, q *db.Queries, userID uuid.UUID, code string) error {
	if _, err := q.GetBooking(ctx, db.GetBookingParams{UserID: userID, Code: code}); errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	} else if err != nil {
		return err
	}
	return errNotActive
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID, code string) (Booking, error) {
	r, err := s.q.GetBooking(ctx, db.GetBookingParams{UserID: userID, Code: code})
	if errors.Is(err, pgx.ErrNoRows) {
		return Booking{}, errNotFound
	}
	if err != nil {
		return Booking{}, err
	}
	b := Booking{
		Code: r.Code, Status: r.Status, ExpiresAt: r.ExpiresAt,
		Product:   Product{Slug: r.ProductSlug, Name: r.ProductName, Tag: r.ProductTag, ImageURL: r.ProductImage},
		FareLabel: r.FareLabel, DepartDate: r.DepartDate.Format(time.DateOnly), ReturnDate: dateStr(r.ReturnDate),
		Adults: r.Adults, Children: r.Children, AdultPrice: r.AdultPrice, ChildPrice: r.ChildPrice,
		Total: r.Total, CreatedAt: r.CreatedAt, Passengers: []Passenger{},
	}
	// Worker chạy 30 giây một lần: đơn quá giờ mà worker chưa kịp chuyển vẫn coi như hết hạn
	if (b.Status == "held" || b.Status == "awaiting_payment") && !time.Now().Before(r.ExpiresAt) {
		b.Status = "expired"
	}
	if b.Status == "held" || b.Status == "awaiting_payment" {
		// Làm tròn LÊN: còn 0,4 giây thì báo 1. Làm tròn xuống ra 0 trong khi đơn vẫn còn hiệu lực,
		// trình duyệt đếm về 0, tải lại, vẫn nhận "còn giữ chỗ" với 0 giây và kẹt ở đó.
		b.ExpiresIn = int64(math.Ceil(time.Until(r.ExpiresAt).Seconds()))
	}
	if r.ContactName != nil {
		b.Contact = &Contact{Name: *r.ContactName, Phone: deref(r.ContactPhone), Email: deref(r.ContactEmail)}
	}
	ps, err := s.q.ListBookingPassengers(ctx, r.ID)
	if err != nil {
		return Booking{}, err
	}
	for _, p := range ps {
		b.Passengers = append(b.Passengers, Passenger{
			Kind: p.Kind, FullName: p.FullName, BirthDate: p.BirthDate.Format(time.DateOnly),
		})
	}
	return b, nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, cursorStr string) (Page, error) {
	var c cursor
	has, err := pagination.Decode(cursorStr, &c)
	if err != nil {
		return Page{}, err
	}
	arg := db.ListBookingsParams{UserID: userID, Limit: pageSize + 1}
	if has {
		arg.CursorTime, arg.CursorID = &c.T, &c.ID
	}
	rows, err := s.q.ListBookings(ctx, arg)
	if err != nil {
		return Page{}, err
	}
	p := Page{Items: make([]Summary, 0, len(rows))}
	now := time.Now()
	for i, r := range rows {
		if i == pageSize {
			last := rows[pageSize-1]
			p.NextCursor = pagination.Encode(cursor{T: last.CreatedAt, ID: last.ID})
			break
		}
		status := r.Status
		if (status == "held" || status == "awaiting_payment") && !now.Before(r.ExpiresAt) {
			status = "expired"
		}
		p.Items = append(p.Items, Summary{
			Code: r.Code, Status: status, ExpiresAt: r.ExpiresAt, ProductName: r.ProductName,
			ProductImage: r.ProductImage, FareLabel: r.FareLabel, DepartDate: r.DepartDate.Format(time.DateOnly),
			Adults: r.Adults, Children: r.Children, Total: r.Total, CreatedAt: r.CreatedAt,
		})
	}
	return p, nil
}

// validateDetails kiểm tra người liên hệ và hành khách. Số người lớn / trẻ em phải khớp lúc giữ
// chỗ (giá đã tính theo đó); tuổi tính theo NGÀY KHỞI HÀNH, không phải hôm nay.
func validateDetails(in DetailsInput, adults, children int16, departDate time.Time) (Contact, []Passenger, error) {
	fields := map[string]string{}
	c := Contact{
		Name:  strings.TrimSpace(in.ContactName),
		Phone: strings.NewReplacer(" ", "", ".", "", "-", "").Replace(in.ContactPhone),
		Email: strings.TrimSpace(in.ContactEmail),
	}
	if n := utf8.RuneCountInString(c.Name); n < 2 || n > 100 {
		fields["contact_name"] = "Họ tên từ 2 đến 100 ký tự"
	}
	if !phoneRe.MatchString(c.Phone) {
		fields["contact_phone"] = "Số điện thoại Việt Nam không hợp lệ"
	}
	if a, err := mail.ParseAddress(c.Email); err != nil || a.Address != c.Email {
		fields["contact_email"] = "Email không hợp lệ"
	}

	if len(in.Passengers) != int(adults+children) {
		fields["passengers"] = fmt.Sprintf("Cần đúng %d hành khách", adults+children)
	}
	out := make([]Passenger, 0, len(in.Passengers))
	var gotAdults, gotChildren int16
	for i, p := range in.Passengers {
		name := PassportName(p.FullName)
		if !nameRe.MatchString(name) || len(name) > 60 {
			fields[fmt.Sprintf("passengers.%d.full_name", i)] = "Họ và tên như trên giấy tờ, VD: NGUYEN VAN AN"
		}
		birth, err := time.Parse(time.DateOnly, p.BirthDate)
		age := ageOn(birth, departDate)
		var kind string
		switch {
		case err != nil || birth.After(departDate):
			fields[fmt.Sprintf("passengers.%d.birth_date", i)] = "Ngày sinh không hợp lệ"
		case age < childMinAge:
			fields[fmt.Sprintf("passengers.%d.birth_date", i)] = "Chưa nhận đặt cho em bé dưới 2 tuổi"
		case age < adultMinAge:
			kind = "child"
			gotChildren++
		default:
			kind = "adult"
			gotAdults++
		}
		out = append(out, Passenger{Kind: kind, FullName: name, BirthDate: p.BirthDate})
	}
	if len(fields) == 0 && (gotAdults != adults || gotChildren != children) {
		fields["passengers"] = fmt.Sprintf(
			"Đơn giữ chỗ cho %d người lớn, %d trẻ em (2–11 tuổi tại ngày khởi hành); ngày sinh đã nhập không khớp",
			adults, children)
	}
	if len(fields) > 0 {
		return c, nil, apperr.Invalid("validation_failed", "Thông tin hành khách chưa hợp lệ").WithFields(fields)
	}
	return c, out, nil
}

// ageOn: số tuổi tròn vào ngày on
func ageOn(birth, on time.Time) int {
	age := on.Year() - birth.Year()
	// Chưa tới sinh nhật năm nay thì chưa thêm tuổi. So tháng, ngày (không so YearDay: năm nhuận
	// làm YearDay của cùng một ngày lệch nhau 1)
	if on.Month() < birth.Month() || (on.Month() == birth.Month() && on.Day() < birth.Day()) {
		age--
	}
	return age
}

// PassportName: "Nguyễn Văn  Đức" → "NGUYEN VAN DUC". Bỏ dấu bằng cách tách chữ thành chữ gốc +
// dấu (chuẩn hoá NFD) rồi xoá các dấu (nhóm Unicode Mn); "đ" không phải chữ "d" có dấu nên đổi tay.
func PassportName(s string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	out, _, err := transform.String(t, s)
	if err != nil {
		out = s
	}
	out = strings.NewReplacer("đ", "d", "Đ", "D").Replace(out)
	return strings.ToUpper(spacesRe.ReplaceAllString(strings.TrimSpace(out), " "))
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
```

Phần giữ chỗ (`Availability`, `Hold`):

- **`tomorrow()` theo giờ Việt Nam**: chốt đặt trước một ngày. Server chạy giờ UTC; không đổi múi giờ thì
  từ 0 giờ đến 7 giờ sáng ở Việt Nam, "ngày mai" bị tính lùi một ngày.
- **Gom ngày**: truy vấn trả mỗi dòng một (ngày, hạng) đã sắp theo ngày; dòng nào khác ngày với dòng trước
  thì mở ngày mới, cùng ngày thì thêm hạng vào ngày đang mở.
- **`maxActiveHolds = 2`**: giữ chỗ không mất tiền. Không giới hạn thì một tài khoản giữ sạch chỗ của một
  chuyến rồi bỏ đó, người thật không đặt được trong 20 phút, lặp lại mãi. Kèm bắt xác minh email như đặt
  hàng (bài 7.05).
- **Lấy ghế xong mới tạo đơn, trong một transaction**: tạo đơn lỗi (vd. trùng khoá) thì ghế tự trả lại.
- **`TakeSeats` trả 0 dòng thì hỏi `SeatsLeft`** để báo "hết chỗ" hay "chỉ còn N chỗ": khách biết nên giảm
  số khách hay chọn ngày khác.

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
```

Routes ở bài 8.04.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `make lint`: `undefined: newCode` sau khi tách gói | Còn chỗ gọi `newCode()` trong `order.go`; đổi thành `refcode.New("AL-")` |
| Lúc nửa đêm đến 7 giờ sáng, đặt được chuyến của ngày hôm nay | `tomorrow()` tính theo giờ server (UTC) thay vì giờ Việt Nam |
