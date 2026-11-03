# Bài 10.02: Tính trạng thái chuyến bay và vị trí máy bay từ giờ

> [← Bài trước](01-du-lieu-lich-bay.md) · [Mục lục](../README.md) · [Bài sau →](03-api-chuyen-bay.md)

## Mục tiêu

Hai file Go thuần túy (không database, không mạng): `status.go` đổi lịch bay thành "chuyến bay hôm nay" có trạng thái, tiến độ và
vị trí; `geo.go` tính điểm nằm trên đường bay.

## Bạn sẽ học

- Tính theo múi giờ đúng (sân bay đi và đến khác múi giờ, chuyến qua nửa đêm).
- Máy bay bay theo **đường ngắn nhất trên mặt cầu** (cung tròn lớn), không phải đường thẳng.
- Nội suy cầu (slerp) trên vector đơn vị 3 chiều.
- Truyền `now` vào hàm thay vì gọi `time.Now()` bên trong: hàm dễ kiểm chứng, không phụ thuộc đồng hồ.

## Viết code

### Bước 1: Hình học, `backend/internal/flight/geo.go`

```go
package flight

import "math"

const degToRad = math.Pi / 180

// greatCircle trả về điểm nằm ở t (0..1) trên đường ngắn nhất giữa hai điểm trên mặt cầu, và hướng
// bay (độ, 0 = bắc, 90 = đông) tại điểm đó. Máy bay bay theo đường này, không phải đường thẳng
// trên bản đồ phẳng: Hà Nội – Tokyo nhìn trên bản đồ Mercator là đường cong.
//
// Nội suy cầu (slerp) trên vector đơn vị 3 chiều. Hai điểm trùng nhau hoặc đối xứng tuyệt đối thì
// không có đường duy nhất; sân bay thật không bao giờ rơi vào hai trường hợp này.
func greatCircle(lat1, lon1, lat2, lon2, t float64) (lat, lon, heading float64) {
	a := toVec(lat1, lon1)
	b := toVec(lat2, lon2)
	dot := math.Max(-1, math.Min(1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))
	omega := math.Acos(dot) // góc giữa hai điểm nhìn từ tâm Trái Đất
	if omega < 1e-9 {
		return lat1, lon1, 0
	}
	at := func(t float64) [3]float64 {
		ka := math.Sin((1-t)*omega) / math.Sin(omega)
		kb := math.Sin(t*omega) / math.Sin(omega)
		return [3]float64{ka*a[0] + kb*b[0], ka*a[1] + kb*b[1], ka*a[2] + kb*b[2]}
	}
	p := at(t)
	lat, lon = fromVec(p)

	// Hướng bay = hướng từ điểm hiện tại tới điểm ngay phía trước một chút
	ahead := at(math.Min(1, t+0.01))
	if t >= 0.99 {
		ahead = b
	}
	alat, alon := fromVec(ahead)
	return lat, lon, bearing(lat, lon, alat, alon)
}

func toVec(lat, lon float64) [3]float64 {
	la, lo := lat*degToRad, lon*degToRad
	return [3]float64{math.Cos(la) * math.Cos(lo), math.Cos(la) * math.Sin(lo), math.Sin(la)}
}

func fromVec(v [3]float64) (lat, lon float64) {
	return math.Atan2(v[2], math.Hypot(v[0], v[1])) / degToRad, math.Atan2(v[1], v[0]) / degToRad
}

// bearing là góc phương vị ban đầu từ điểm 1 tới điểm 2, trong khoảng [0, 360).
func bearing(lat1, lon1, lat2, lon2 float64) float64 {
	p1, p2 := lat1*degToRad, lat2*degToRad
	dl := (lon2 - lon1) * degToRad
	y := math.Sin(dl) * math.Cos(p2)
	x := math.Cos(p1)*math.Sin(p2) - math.Sin(p1)*math.Cos(p2)*math.Cos(dl)
	return math.Mod(math.Atan2(y, x)/degToRad+360, 360)
}
```

Đổi (vĩ độ, kinh độ) sang vector đơn vị trên cầu `(x, y, z)`. Điểm cách A một phần `t` của đường đến B là
`sin((1−t)Ω)/sin Ω · A + sin(tΩ)/sin Ω · B` với Ω là góc giữa A và B. Đổi ngược ra vĩ độ, kinh độ.
Nội suy thẳng trên (vĩ độ, kinh độ) cho kết quả sai: Hà Nội đi Tokyo thật sự bay vòng lên phía bắc.

`heading` là hướng từ điểm hiện tại tới điểm ngay phía trước (t + 1%), đổi sang góc phương vị 0–360°. Frontend xoay biểu
tượng máy bay đúng góc này.

### Bước 2: Trạng thái, `backend/internal/flight/status.go`

```go
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
```

Điểm cần hiểu:

- `build` dựng một lần bay cụ thể từ lịch + ngày + `now`: giờ cất cánh = ngày địa phương + `dep_minute`, cộng phút trễ; giờ
  đến = cất cánh + thời gian bay. Trạng thái: trước giờ lên tàu 40 phút → `scheduled`; 40 phút cuối → `boarding`;
  giữa cất cánh và hạ cánh → `in_air` kèm tiến độ và vị trí; sau đó `landed`.
- `current` chọn **lần bay nào đang liên quan**. Lịch bay lặp mỗi ngày, nên lúc 01:00 sáng chuyến cất cánh 23:30 tối qua vẫn đang bay: ta
  thử lần của hôm qua trước, còn đang bay (hoặc vừa hạ cánh dưới 90 phút) thì lấy nó, không thì lấy lần hôm nay.
- `ArrNextDay`: giờ đến rơi sang ngày dương lịch khác so với ngày đi (hiện "+1"). So sánh **ngày dương lịch ở từng sân bay**,
  không phải cộng 24 giờ.
- `time.Date(y, m, d, 0, dep_minute, 0, 0, loc)`: tham số phút lớn hơn 59 được Go tự đổi thành giờ, nên `dep_minute = 480` ra đúng 08:00.

## Kiểm tra

Gọi API ở bài 10.05 và đối chiếu bằng tay: VN 300 cất cánh Sài Gòn 00:05, bay 345 phút → hạ cánh Narita 07:50 giờ Nhật.
Với chuyến đang bay, `progress ≈ (giờ hiện tại − giờ cất cánh) / thời gian bay`.

## Hay gặp lỗi

- **Cộng 24 giờ thay vì đổi ngày theo múi giờ**: sai vào ngày chuyển giờ mùa hè ở nước có DST. Dùng `time.Date` với `*time.Location`.
- **Quên chuyến qua đêm**: lúc 00:30 chuyến cất cánh 23:45 biến mất khỏi bảng nếu chỉ xét ngày hôm nay.
- **`Acos` ra NaN**: sai số làm tích vô hướng 1.0000000002. Phải kẹp vào [-1, 1] (trong code có `math.Max/Min`).
