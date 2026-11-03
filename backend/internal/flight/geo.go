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
