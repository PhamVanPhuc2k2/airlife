# Bài 10.04: Thời tiết sân bay, gọi dịch vụ bên ngoài cho đúng cách

> [← Bài trước](03-api-chuyen-bay.md) · [Mục lục](../README.md) · [Bài sau →](05-thu-api.md)

## Mục tiêu

Lấy thời tiết 8 sân bay từ Open-Meteo, cache trong Redis, và vẫn chạy khi Open-Meteo lỗi.

## Bạn sẽ học

- Gọi API bên thứ ba: **timeout**, giới hạn kích thước phản hồi, không tin dữ liệu.
- Cache hai lớp: bản **tươi** 30 phút và bản **cũ** 24 giờ để dự phòng.
- `singleflight`: nhiều request cùng lúc chỉ gây **một** cuộc gọi ra ngoài.
- Thêm loại lỗi mới `Unavailable` (503) cho "dịch vụ ngoài đang hỏng".

## Viết code

### Bước 1: Client Open-Meteo, `backend/pkg/weather/weather.go`

```go
// Package weather gọi Open-Meteo (https://open-meteo.com) lấy thời tiết hiện tại theo toạ độ.
//
// Open-Meteo miễn phí, không cần khoá API, và nhận nhiều toạ độ trong MỘT request: lấy thời tiết
// cả 8 sân bay chỉ tốn một lần gọi. Dịch vụ miễn phí chỉ dùng cho phi thương mại; khi chạy kinh
// doanh thật cần gói trả phí của họ (đổi BaseURL + thêm khoá API, code giữ nguyên).
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Điều kiện thời tiết gom thành mấy nhóm mà giao diện có icon.
const (
	Sun   = "sun"
	Cloud = "cloud"
	Rain  = "rain"
	Storm = "storm"
	Fog   = "fog"
	Snow  = "snow"
)

type Point struct{ Lat, Lon float64 }

type Reading struct {
	TempC      float64 `json:"temp_c"`
	FeelsLikeC float64 `json:"feels_like_c"`
	Humidity   int     `json:"humidity"`
	WindKmh    float64 `json:"wind_kmh"`
	Condition  string  `json:"condition"` // sun | cloud | rain | storm | fog | snow
	Text       string  `json:"text"`
	IsDay      bool    `json:"is_day"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient tạo client. Timeout ngắn: thời tiết chỉ là phần phụ của trang, không đáng để treo request.
func NewClient(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 6 * time.Second}}
}

// maxBody giới hạn phản hồi: server bên thứ ba lỗi cũng không làm ta đọc đầy bộ nhớ.
const maxBody = 1 << 20

type apiCurrent struct {
	Temp     float64 `json:"temperature_2m"`
	Feels    float64 `json:"apparent_temperature"`
	Humidity float64 `json:"relative_humidity_2m"`
	Wind     float64 `json:"wind_speed_10m"`
	Code     int     `json:"weather_code"`
	IsDay    int     `json:"is_day"`
}

type apiResult struct {
	Current apiCurrent `json:"current"`
}

// Fetch trả thời tiết hiện tại theo đúng thứ tự points.
func (c *Client) Fetch(ctx context.Context, points []Point) ([]Reading, error) {
	if len(points) == 0 {
		return nil, nil
	}
	lats, lons := make([]string, len(points)), make([]string, len(points))
	for i, p := range points {
		lats[i], lons[i] = strconv.FormatFloat(p.Lat, 'f', 4, 64), strconv.FormatFloat(p.Lon, 'f', 4, 64)
	}
	q := url.Values{}
	q.Set("latitude", strings.Join(lats, ","))
	q.Set("longitude", strings.Join(lons, ","))
	q.Set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day")
	q.Set("timezone", "auto")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/forecast?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gọi open-meteo: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("đọc phản hồi open-meteo: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("open-meteo trả %d: %.200s", resp.StatusCode, body)
	}

	// Một toạ độ → object; nhiều toạ độ → mảng. Đọc cả hai về mảng.
	var results []apiResult
	if len(points) == 1 {
		var one apiResult
		if err := json.Unmarshal(body, &one); err != nil {
			return nil, fmt.Errorf("giải mã open-meteo: %w", err)
		}
		results = []apiResult{one}
	} else if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("giải mã open-meteo: %w", err)
	}
	if len(results) != len(points) {
		return nil, fmt.Errorf("open-meteo trả %d kết quả cho %d toạ độ", len(results), len(points))
	}

	out := make([]Reading, len(results))
	for i, r := range results {
		cond, text := describe(r.Current.Code)
		out[i] = Reading{
			TempC: r.Current.Temp, FeelsLikeC: r.Current.Feels, Humidity: int(r.Current.Humidity),
			WindKmh: r.Current.Wind, Condition: cond, Text: text, IsDay: r.Current.IsDay == 1,
		}
	}
	return out, nil
}

// describe đổi mã thời tiết WMO (0–99) sang nhóm icon + mô tả tiếng Việt.
// Bảng mã: https://open-meteo.com/en/docs (mục "WMO Weather interpretation codes").
func describe(code int) (cond, text string) {
	switch {
	case code == 0:
		return Sun, "Trời quang"
	case code == 1:
		return Sun, "Nắng đẹp"
	case code == 2:
		return Cloud, "Có mây"
	case code == 3:
		return Cloud, "Nhiều mây"
	case code == 45 || code == 48:
		return Fog, "Sương mù"
	case code >= 51 && code <= 57:
		return Rain, "Mưa phùn"
	case code >= 61 && code <= 67, code >= 80 && code <= 82:
		return Rain, "Có mưa"
	case code >= 71 && code <= 77, code == 85 || code == 86:
		return Snow, "Có tuyết"
	case code >= 95:
		return Storm, "Dông"
	default:
		return Cloud, "Nhiều mây"
	}
}
```

- Open-Meteo nhận nhiều toạ độ trong **một** request (`latitude=a,b,c&longitude=x,y,z`): 8 sân bay chỉ tốn một lần gọi. Một toạ độ
  thì trả object, nhiều toạ độ thì trả mảng, nên code đọc cả hai.
- `http.Client{Timeout: 6s}`: không đặt timeout thì server của họ treo là request của ta treo theo.
- `io.LimitReader(resp.Body, 1<<20)`: phản hồi bất thường (hoặc bị tấn công) không làm tràn bộ nhớ.
- Kết quả phải đúng số lượng toạ độ gửi đi; lệch là lỗi chứ không đoán.
- Mã thời tiết WMO (0–99) được gom thành 6 nhóm có icon: `sun`, `cloud`, `rain`, `storm`, `fog`, `snow`, kèm câu tiếng Việt.

### Bước 2: Loại lỗi mới, `backend/pkg/apperr` và `backend/pkg/response`

```go
// apperr.go
KindUnavailable // 503: dịch vụ bên ngoài đang lỗi

func Unavailable(code, msg string) *Error {
	return &Error{Kind: KindUnavailable, Code: code, Message: msg}
}

// WithErr gắn lỗi gốc để ghi log (client không thấy).
func (e *Error) WithErr(err error) *Error { e.Err = err; return e }
```

Trong `response.statusOf` thêm `case apperr.KindUnavailable: return http.StatusServiceUnavailable`. Dùng 503 thay vì 500 vì lỗi
không nằm ở code ta, và client biết nên thử lại sau.

### Bước 3: Service, `backend/internal/weather/weather.go`

```go
// Package weather: thời tiết tại các sân bay (Phần 10), lấy từ Open-Meteo và cache trong Redis.
//
// Hai lớp cache:
//   - tươi, 30 phút: trong thời gian này không gọi Open-Meteo lần nào, bao nhiêu người xem cũng vậy;
//   - cũ, 24 giờ: Open-Meteo lỗi hay chậm thì trả dữ liệu cũ kèm "stale": true, tốt hơn là báo lỗi.
package weather

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/flight"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
	pkgweather "github.com/PhamVanPhuc2k2/airlife/backend/pkg/weather"
)

const (
	freshKey = "cache:weather:fresh"
	staleKey = "cache:weather:stale"
	freshTTL = 30 * time.Minute
	staleTTL = 24 * time.Hour
)

type Airport struct {
	Code string `json:"code"`
	City string `json:"city"`
	pkgweather.Reading
}

type Report struct {
	UpdatedAt time.Time `json:"updated_at"`
	// Stale = true: Open-Meteo đang lỗi, đây là dữ liệu đã lưu trước đó
	Stale    bool      `json:"stale"`
	Airports []Airport `json:"airports"`
}

type Service struct {
	flights *flight.Service
	client  *pkgweather.Client
	rdb     *redis.Client
	log     *slog.Logger
	group   singleflight.Group
	now     func() time.Time
}

func NewService(flights *flight.Service, client *pkgweather.Client, rdb *redis.Client, log *slog.Logger) *Service {
	return &Service{flights: flights, client: client, rdb: rdb, log: log, now: time.Now}
}

func (s *Service) Get(ctx context.Context) (Report, error) {
	if rep, ok := s.read(ctx, freshKey); ok {
		return rep, nil
	}
	// Nhiều request cùng lúc thấy cache hết hạn thì chỉ MỘT request gọi Open-Meteo, những request còn
	// lại chờ và nhận cùng kết quả (singleflight). Không có nó, cache hết hạn đúng lúc đông người xem
	// sẽ bắn hàng loạt request ra ngoài.
	v, err, _ := s.group.Do("refresh", func() (any, error) {
		// Context của request đầu có thể bị huỷ giữa chừng (người dùng đóng tab) làm hỏng kết quả
		// của những request đang chờ: dùng context riêng có thời hạn.
		c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		return s.refresh(c)
	})
	if err == nil {
		return v.(Report), nil
	}

	s.log.WarnContext(ctx, "lấy thời tiết lỗi, dùng dữ liệu cũ nếu có", "err", err)
	if rep, ok := s.read(ctx, staleKey); ok {
		rep.Stale = true
		return rep, nil
	}
	return Report{}, apperr.Unavailable("weather_unavailable", "Chưa lấy được thời tiết, vui lòng thử lại sau").WithErr(err)
}

func (s *Service) refresh(ctx context.Context) (Report, error) {
	aps, err := s.flights.Airports(ctx)
	if err != nil {
		return Report{}, err
	}
	points := make([]pkgweather.Point, len(aps))
	for i, a := range aps {
		points[i] = pkgweather.Point{Lat: a.Lat, Lon: a.Lon}
	}
	readings, err := s.client.Fetch(ctx, points)
	if err != nil {
		return Report{}, err
	}
	rep := Report{UpdatedAt: s.now().UTC(), Airports: make([]Airport, len(aps))}
	for i, a := range aps {
		rep.Airports[i] = Airport{Code: a.Code, City: a.City, Reading: readings[i]}
	}
	if b, err := json.Marshal(rep); err == nil {
		pipe := s.rdb.Pipeline()
		pipe.Set(ctx, freshKey, b, freshTTL)
		pipe.Set(ctx, staleKey, b, staleTTL)
		if _, err := pipe.Exec(ctx); err != nil {
			s.log.WarnContext(ctx, "ghi cache thời tiết lỗi", "err", err)
		}
	}
	return rep, nil
}

func (s *Service) read(ctx context.Context, key string) (Report, bool) {
	b, err := s.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			s.log.WarnContext(ctx, "đọc cache thời tiết lỗi", "key", key, "err", err)
		}
		return Report{}, false
	}
	var rep Report
	if json.Unmarshal(b, &rep) != nil {
		return Report{}, false
	}
	return rep, true
}

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// GET /weather — thời tiết hiện tại tại mọi sân bay
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	rep, err := h.svc.Get(r.Context())
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, rep)
}
```

Trình tự của `Get`:

1. Có bản **tươi** trong Redis → trả ngay (3 ms, không gọi ai).
2. Không có → `singleflight.Group.Do`: trong lúc một request đang hỏi Open-Meteo, mọi request đến thêm **chờ** và dùng chung kết quả.
   Thiếu bước này, đúng lúc cache hết hạn và đông người xem, hàng trăm request bắn ra ngoài cùng lúc.
3. Hỏi Open-Meteo lỗi → thử bản **cũ** (24 giờ), trả kèm `stale: true`. Người dùng vẫn thấy thời tiết (hơi cũ) thay vì trang lỗi,
   và giao diện ghi chú.
4. Không có cả bản cũ → 503 `weather_unavailable`.

`context.WithoutCancel(ctx)` + timeout riêng cho lần gọi: nếu người đầu tiên đóng tab giữa chừng, context của họ bị huỷ và những người đang chờ chung
kết quả sẽ nhận lỗi oan.

### Bước 4: Cấu hình

`backend/internal/config/config.go` có nhóm `Weather{BaseURL}` (`WEATHER_BASE_URL`, mặc định `https://api.open-meteo.com`). Dịch vụ miễn phí chỉ cho
dự án phi thương mại; khi kinh doanh thật, đổi sang gói trả phí của họ bằng biến môi trường, không sửa code.

## Kiểm tra

```bash
curl -s -w '%{time_total}s\n' -o /dev/null localhost:8080/api/v1/weather   # lần đầu ~1 giây, sau đó vài ms
```

Thử lỗi: chạy một API khác với `WEATHER_BASE_URL=http://127.0.0.1:1` rồi gọi `/weather`: còn cache cũ thì trả `"stale": true`;
xoá cả hai khoá `cache:weather:*` thì trả 503.

## Hay gặp lỗi

- **`errcheck` của golangci-lint báo `resp.Body.Close`**: viết `defer func() { _ = resp.Body.Close() }()` (cùng cách với `pkg/payment/fake.go`).
- **Không đặt `timeout`**: Go mặc định chờ vô hạn.
- **Cache một khoá có TTL hết đúng lúc đông người**: đó là lý do có `singleflight`.
