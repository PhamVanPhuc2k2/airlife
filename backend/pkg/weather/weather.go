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
