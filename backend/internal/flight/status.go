package flight

import (
	"strings"
	"time"
)

type Status string

const (
	StatusScheduled Status = "scheduled" // chưa tới giờ lên tàu
	StatusBoarding  Status = "boarding"  // trong 40 phút trước giờ cất cánh
	StatusInAir     Status = "in_air"
	StatusLanded    Status = "landed"
	StatusCancelled Status = "cancelled"
)

const (
	boardingLead = 40 * time.Minute // lên tàu trước giờ cất cánh 40 phút (mockup: "Trước 40 phút")
	// Chuyến đã hạ cánh vẫn hiện ở bảng thêm một lúc, sau đó bảng chuyển sang chuyến của ngày kế tiếp
	landedKeep = 90 * time.Minute
)

// Airport là sân bay trong lịch bay.
type Airport struct {
	Code     string  `json:"code"`
	City     string  `json:"city"`
	Name     string  `json:"name"`
	Country  string  `json:"country"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Timezone string  `json:"timezone"`
}

// Schedule là một dòng lịch bay hàng ngày trong database.
type Schedule struct {
	Code        string `json:"code"`
	Airline     string `json:"airline"`
	Origin      string `json:"origin"`
	Destination string `json:"destination"`
	DepMinute   int    `json:"dep_minute"` // phút kể từ 00:00 giờ địa phương sân bay đi
	Duration    int    `json:"duration"`   // phút
	Delay       int    `json:"delay"`      // phút
	Gate        string `json:"gate"`
	Cancelled   bool   `json:"cancelled"`
}

type Position struct {
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Heading float64 `json:"heading"` // độ, 0 = bắc
}

// Flight là một chuyến bay vào một ngày cụ thể, kèm trạng thái tại thời điểm hỏi.
type Flight struct {
	Code    string  `json:"code"`
	Airline string  `json:"airline"`
	From    Airport `json:"from"`
	To      Airport `json:"to"`
	Gate    string  `json:"gate"`
	Status  Status  `json:"status"`
	// Phút trễ so với lịch (0 = đúng giờ). Chuyến đã bay vẫn giữ số này để hiện "cất cánh trễ".
	DelayMinutes int `json:"delay_minutes"`
	// Giờ theo giờ địa phương của từng sân bay, dạng "08:00". Đã tính cả phút trễ.
	Dep string `json:"dep"`
	Arr string `json:"arr"`
	// Giờ đến rơi vào ngày kế tiếp so với ngày đi (hiện "+1")
	ArrNextDay bool `json:"arr_next_day"`
	// Giờ lên tàu theo giờ địa phương sân bay đi
	Boarding string `json:"boarding"`
	// Thời điểm chính xác (RFC 3339, UTC) để frontend tính đếm ngược nếu cần
	DepAt time.Time `json:"dep_at"`
	ArrAt time.Time `json:"arr_at"`
	// 0..1; 0 khi chưa bay, 1 khi đã hạ cánh
	Progress float64 `json:"progress"`
	// Chỉ có khi đang bay
	Position *Position `json:"position,omitempty"`
}

// normalizeCode bỏ khoảng trắng và viết hoa để so khớp: "vn 220" và "VN220" cùng thành "VN220".
func normalizeCode(s string) string {
	return strings.ToUpper(strings.Join(strings.Fields(s), ""))
}

func squash(code string) string { return strings.ReplaceAll(code, " ", "") }

// build tính chuyến bay s vào ngày địa phương date (chỉ lấy năm, tháng, ngày) tại thời điểm now.
func build(s Schedule, from, to Airport, fromLoc, toLoc *time.Location, date time.Time, now time.Time) Flight {
	y, m, d := date.Date()
	sched := time.Date(y, m, d, 0, s.DepMinute, 0, 0, fromLoc) // time.Date chuẩn hoá phút > 59 thành giờ
	dep := sched.Add(time.Duration(s.Delay) * time.Minute)
	arr := dep.Add(time.Duration(s.Duration) * time.Minute)

	f := Flight{
		Code: s.Code, Airline: s.Airline, From: from, To: to, Gate: s.Gate,
		DelayMinutes: s.Delay,
		Dep:          dep.In(fromLoc).Format("15:04"),
		Arr:          arr.In(toLoc).Format("15:04"),
		Boarding:     dep.Add(-boardingLead).In(fromLoc).Format("15:04"),
		DepAt:        dep.UTC(), ArrAt: arr.UTC(),
	}
	// "Ngày kế tiếp" so sánh ngày dương lịch của giờ đi (ở sân bay đi) với giờ đến (ở sân bay đến)
	ay, am, ad := arr.In(toLoc).Date()
	f.ArrNextDay = time.Date(ay, am, ad, 0, 0, 0, 0, time.UTC).After(time.Date(y, m, d, 0, 0, 0, 0, time.UTC))
	if dy, dm, dd := dep.In(fromLoc).Date(); dd != d || dm != m || dy != y {
		// Chuyến trễ qua nửa đêm: ngày đi thực tế đã sang ngày kế
		f.ArrNextDay = time.Date(ay, am, ad, 0, 0, 0, 0, time.UTC).After(time.Date(dy, dm, dd, 0, 0, 0, 0, time.UTC))
	}

	switch {
	case s.Cancelled:
		f.Status = StatusCancelled
	case now.Before(dep.Add(-boardingLead)):
		f.Status = StatusScheduled
	case now.Before(dep):
		f.Status = StatusBoarding
	case now.Before(arr):
		f.Status = StatusInAir
		f.Progress = float64(now.Sub(dep)) / float64(arr.Sub(dep))
		lat, lon, head := greatCircle(from.Lat, from.Lon, to.Lat, to.Lon, f.Progress)
		f.Position = &Position{Lat: lat, Lon: lon, Heading: head}
	default:
		f.Status = StatusLanded
		f.Progress = 1
	}
	return f
}

// current chọn lần bay "đang liên quan" của một lịch bay hàng ngày tại thời điểm now: lần của hôm
// qua nếu nó còn đang bay hoặc vừa hạ cánh (chuyến đêm qua nửa đêm), không thì lần của hôm nay.
func current(s Schedule, from, to Airport, fromLoc, toLoc *time.Location, now time.Time) Flight {
	today := now.In(fromLoc)
	yesterday := build(s, from, to, fromLoc, toLoc, today.AddDate(0, 0, -1), now)
	if !s.Cancelled && now.Before(yesterday.ArrAt.Add(landedKeep)) {
		return yesterday
	}
	return build(s, from, to, fromLoc, toLoc, today, now)
}
