// Package flight: tiện ích chuyến bay (Phần 10) — bảng chuyến bay, bản đồ Flightradar, chuyến bay của
// tôi (thẻ lên máy bay), gói Wi-Fi.
//
// Nguồn dữ liệu là LỊCH BAY mẫu trong database; trạng thái và vị trí được tính từ giờ hiện tại
// (xem status.go). Nối nguồn dữ liệu thật sau này chỉ cần thay hàm tính trạng thái bằng lời gọi
// API bên thứ ba: các API và frontend ở dưới không đổi.
package flight

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/cache"
)

const (
	refreshRef  = time.Minute // lịch bay và sân bay hiếm khi đổi: cache 1 phút
	maxUpcoming = 10          // mỗi người theo dõi tối đa 10 chuyến sắp tới
	maxAhead    = 365         // chỉ thêm chuyến trong vòng 1 năm tới
)

var (
	seatRe  = regexp.MustCompile(`^[0-9]{1,2}[A-K]$`)
	cabins  = map[string]bool{"economy": true, "premium": true, "business": true, "first": true}
	errNoFl = apperr.NotFound("flight_not_found", "Không tìm thấy chuyến bay")
)

type Service struct {
	q   *db.Queries
	rdb *redis.Client
	now func() time.Time // thay được khi cần thử giờ khác
}

func NewService(q *db.Queries, rdb *redis.Client) *Service {
	return &Service{q: q, rdb: rdb, now: time.Now}
}

// reference là dữ liệu tham chiếu đọc từ database một lần mỗi phút rồi dùng chung.
type reference struct {
	Airports  map[string]Airport `json:"airports"`
	Schedules []Schedule         `json:"schedules"`
}

func (s *Service) reference(ctx context.Context) (reference, error) {
	return cache.Remember(ctx, s.rdb, "cache:flights:ref", refreshRef, func(ctx context.Context) (reference, error) {
		aps, err := s.q.ListAirports(ctx)
		if err != nil {
			return reference{}, err
		}
		fls, err := s.q.ListFlights(ctx)
		if err != nil {
			return reference{}, err
		}
		ref := reference{Airports: make(map[string]Airport, len(aps)), Schedules: make([]Schedule, 0, len(fls))}
		for _, a := range aps {
			ref.Airports[a.Code] = Airport{Code: a.Code, City: a.City, Name: a.Name, Country: a.Country, Lat: a.Lat, Lon: a.Lon, Timezone: a.Timezone}
		}
		for _, f := range fls {
			ref.Schedules = append(ref.Schedules, Schedule{
				Code: f.Code, Airline: f.Airline, Origin: f.Origin, Destination: f.Destination,
				DepMinute: int(f.DepLocal.Microseconds / 6e7), Duration: int(f.DurationMinutes),
				Delay: int(f.DelayMinutes), Gate: f.Gate, Cancelled: f.Cancelled,
			})
		}
		return ref, nil
	})
}

// resolver ghép lịch bay với sân bay và múi giờ.
type resolver struct {
	ref  reference
	locs map[string]*time.Location
}

func newResolver(ref reference) (*resolver, error) {
	r := &resolver{ref: ref, locs: make(map[string]*time.Location, len(ref.Airports))}
	for code, a := range ref.Airports {
		loc, err := time.LoadLocation(a.Timezone)
		if err != nil {
			return nil, fmt.Errorf("sân bay %s: múi giờ %q: %w", code, a.Timezone, err)
		}
		r.locs[code] = loc
	}
	return r, nil
}

func (r *resolver) schedule(code string) (Schedule, bool) {
	want := normalizeCode(code)
	for _, s := range r.ref.Schedules {
		if squash(s.Code) == want {
			return s, true
		}
	}
	return Schedule{}, false
}

func (r *resolver) flight(s Schedule, date *time.Time, now time.Time) Flight {
	from, to := r.ref.Airports[s.Origin], r.ref.Airports[s.Destination]
	if date != nil {
		return build(s, from, to, r.locs[s.Origin], r.locs[s.Destination], *date, now)
	}
	return current(s, from, to, r.locs[s.Origin], r.locs[s.Destination], now)
}

// Board trả bảng chuyến bay hiện tại, lọc theo q (số hiệu, mã hoặc tên thành phố của sân bay).
// Thứ tự: đang bay, sắp lên tàu, chưa tới giờ, đã hạ cánh.
func (s *Service) Board(ctx context.Context, q string) ([]Flight, error) {
	ref, err := s.reference(ctx)
	if err != nil {
		return nil, err
	}
	res, err := newResolver(ref)
	if err != nil {
		return nil, err
	}
	now := s.now()
	want := normalizeCode(q)
	lowerQ := strings.ToLower(strings.TrimSpace(q))

	out := make([]Flight, 0, len(ref.Schedules))
	for _, sc := range ref.Schedules {
		f := res.flight(sc, nil, now)
		if want != "" && !matches(f, want, lowerQ) {
			continue
		}
		out = append(out, f)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if ri, rj := rank(out[i].Status), rank(out[j].Status); ri != rj {
			return ri < rj
		}
		if out[i].Status == StatusLanded { // đã hạ cánh: mới hạ cánh lên trước
			return out[i].ArrAt.After(out[j].ArrAt)
		}
		return out[i].DepAt.Before(out[j].DepAt)
	})
	return out, nil
}

func matches(f Flight, want, lowerQ string) bool {
	return strings.Contains(squash(f.Code), want) ||
		f.From.Code == want || f.To.Code == want ||
		strings.Contains(strings.ToLower(f.From.City), lowerQ) ||
		strings.Contains(strings.ToLower(f.To.City), lowerQ)
}

func rank(s Status) int {
	switch s {
	case StatusInAir:
		return 0
	case StatusBoarding:
		return 1
	case StatusScheduled, StatusCancelled:
		return 2
	default:
		return 3
	}
}

// Live trả tối đa n chuyến đang bay (khối Tiện ích ở trang chủ).
func (s *Service) Live(ctx context.Context, n int) ([]Flight, error) {
	all, err := s.Board(ctx, "")
	if err != nil {
		return nil, err
	}
	out := make([]Flight, 0, n)
	for _, f := range all {
		if f.Status == StatusInAir && len(out) < n {
			out = append(out, f)
		}
	}
	return out, nil
}

func (s *Service) Airports(ctx context.Context) ([]Airport, error) {
	ref, err := s.reference(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Airport, 0, len(ref.Airports))
	for _, a := range ref.Airports {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out, nil
}

// ---- Chuyến bay của tôi ----

// Mine là một chuyến bay người dùng theo dõi, kèm ghế và hạng.
type Mine struct {
	ID    uuid.UUID `json:"id"`
	Date  string    `json:"date"` // yyyy-mm-dd, ngày cất cánh theo giờ sân bay đi
	Seat  string    `json:"seat"`
	Cabin string    `json:"cabin"`
	Flight
}

type AddInput struct {
	Code  string `json:"code"`
	Date  string `json:"date"` // yyyy-mm-dd
	Seat  string `json:"seat"`
	Cabin string `json:"cabin"`
}

// Mine liệt kê chuyến bay sắp tới của người dùng, sớm nhất trước. Chuyến đã hạ cánh quá 2 giờ thì ẩn.
func (s *Service) Mine(ctx context.Context, userID uuid.UUID) ([]Mine, error) {
	ref, err := s.reference(ctx)
	if err != nil {
		return nil, err
	}
	res, err := newResolver(ref)
	if err != nil {
		return nil, err
	}
	now := s.now()
	rows, err := s.q.ListUserFlights(ctx, db.ListUserFlightsParams{UserID: userID, FromDate: now.AddDate(0, 0, -2)})
	if err != nil {
		return nil, err
	}
	out := make([]Mine, 0, len(rows))
	for _, r := range rows {
		sc, ok := res.schedule(r.Code)
		if !ok {
			continue
		}
		d := r.FlightDate
		f := res.flight(sc, &d, now)
		if f.Status == StatusLanded && now.After(f.ArrAt.Add(2*time.Hour)) {
			continue
		}
		out = append(out, Mine{ID: r.ID, Date: d.Format(time.DateOnly), Seat: r.Seat, Cabin: r.Cabin, Flight: f})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DepAt.Before(out[j].DepAt) })
	return out, nil
}

// Add thêm chuyến bay vào danh sách của người dùng.
func (s *Service) Add(ctx context.Context, userID uuid.UUID, in AddInput) error {
	fields := map[string]string{}
	ref, err := s.reference(ctx)
	if err != nil {
		return err
	}
	res, err := newResolver(ref)
	if err != nil {
		return err
	}

	sc, found := res.schedule(in.Code)
	if !found {
		fields["code"] = "Không tìm thấy chuyến bay này"
	}
	date, err := time.Parse(time.DateOnly, in.Date)
	if err != nil {
		fields["date"] = "Ngày bay không hợp lệ"
	} else if found {
		today := s.now().In(res.locs[sc.Origin])
		first := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
		if date.Before(first) || date.After(first.AddDate(0, 0, maxAhead)) {
			fields["date"] = "Chỉ thêm được chuyến từ hôm nay tới 1 năm sau"
		}
	}
	seat := strings.ToUpper(strings.TrimSpace(in.Seat))
	if seat != "" && !seatRe.MatchString(seat) {
		fields["seat"] = "Số ghế dạng 3A, 12F"
	}
	cabin := in.Cabin
	if cabin == "" {
		cabin = "economy"
	}
	if !cabins[cabin] {
		fields["cabin"] = "Hạng ghế không hợp lệ"
	}
	if len(fields) > 0 {
		return apperr.Invalid("invalid_flight", "Thông tin chuyến bay chưa đúng").WithFields(fields)
	}

	fl, err := s.q.GetFlightByCode(ctx, sc.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNoFl
	}
	if err != nil {
		return err
	}
	n, err := s.q.CountUserFlights(ctx, db.CountUserFlightsParams{UserID: userID, FromDate: s.now().AddDate(0, 0, -2)})
	if err != nil {
		return err
	}
	if n >= maxUpcoming {
		return apperr.Conflict("too_many_flights", "Bạn đang theo dõi tối đa 10 chuyến bay. Xoá bớt chuyến cũ rồi thêm lại")
	}
	added, err := s.q.AddUserFlight(ctx, db.AddUserFlightParams{
		UserID: userID, FlightID: fl.ID, FlightDate: date, Seat: seat, Cabin: cabin,
	})
	if err != nil {
		return err
	}
	if added == 0 {
		return apperr.Conflict("flight_exists", "Bạn đã thêm chuyến bay này vào ngày đó rồi")
	}
	return nil
}

func (s *Service) Remove(ctx context.Context, userID, id uuid.UUID) error {
	n, err := s.q.DeleteUserFlight(ctx, db.DeleteUserFlightParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return errNoFl
	}
	return nil
}

// ---- Gói Wi-Fi ----

type WifiPlan struct {
	ID          int16  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       int64  `json:"price"`
	Popular     bool   `json:"popular"`
}

func (s *Service) WifiPlans(ctx context.Context) ([]WifiPlan, error) {
	rows, err := s.q.ListWifiPlans(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]WifiPlan, 0, len(rows))
	for _, r := range rows {
		out = append(out, WifiPlan{ID: r.ID, Name: r.Name, Description: r.Description, Price: r.Price, Popular: r.Popular})
	}
	return out, nil
}
