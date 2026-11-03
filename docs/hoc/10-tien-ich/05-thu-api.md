# Bài 10.05: Thử API tiện ích bằng curl

> [← Bài trước](04-thoi-tiet.md) · [Mục lục](../README.md) · [Bài sau →](06-frontend-tien-ich.md)

## Mục tiêu

Kiểm tra bằng tay: bảng chuyến bay, tìm kiếm, thời tiết (cache, lỗi), chuyến bay của tôi (hợp lệ, trùng, sai, quá giới hạn).

## Bạn sẽ học

- Đọc kết quả để đối chiếu với **phép tính của bạn** (tiến độ, múi giờ), không chỉ nhìn "200 OK".
- Thử đường lỗi: dữ liệu sai, trùng, vượt giới hạn, chưa đăng nhập.

## Viết code

Không có code mới; chạy các lệnh dưới đây (`$A` là `localhost:8080/api/v1`).

### Bước 1: Bảng chuyến bay, tìm kiếm, thời tiết

```text
$ curl -s "$A/flights" | jq: các chuyến đang bay / sắp bay
VJ 885   HAN→ICN in_air     10:45–16:55  tiến độ 0.21  vị trí 24.81,109.56 hướng 45°
QH 9871  DAD→SIN in_air     11:00–14:05  tiến độ 0.29  vị trí 11.75,106.93 hướng 196°
VN 244   SGN→HAN boarding   12:00–14:10  tiến độ 0.00
VJ 700   SGN→SIN scheduled  14:20–17:20  tiến độ 0.00
VJ 321   SGN→HAN scheduled  16:30–18:40  tiến độ 0.00
VN 7125  DAD→HAN scheduled  19:20–20:40  tiến độ 0.00

$ curl -s "$A/flights?q=tokyo"
['VN 300', 'VJ 822']
$ curl -s "$A/flights?q=vn220"
['VN 220']

$ curl -s $A/weather (lần đầu, rồi lần hai từ cache)
lần 1: 200 0.002065s
xoá cache, gọi Open-Meteo: 200 0.985400s
lần 2 (cache): 200 0.002356s
stale = False | updated_at = 2026-11-03T04:36:35.832293181Z
  BKK Bangkok 32 °C sun - Trời quang
  DAD Đà Nẵng 29.2 °C sun - Trời quang
  HAN Hà Nội 27.4 °C sun - Nắng đẹp
```

Đọc kết quả:

- Lúc chạy là 11:36 giờ Việt Nam. VJ 885 (Hà Nội → Seoul) cất cánh trễ 25 phút, tức 10:45 thay vì 10:20; bay 250 phút nên tiến độ
  là 51/250 ≈ 0,21: khớp. Heading 45° (đông bắc) đúng với hướng Hà Nội → Seoul.
- QH 9871 (Đà Nẵng → Singapore) hướng 196° (nam hơi tây): đúng.
- VN 244 cất cánh 12:00 nên đang `boarding` (40 phút cuối).
- Tìm `tokyo` ra VN 300 và VJ 822; tìm `vn220` (không dấu cách) khớp `VN 220`.
- Thời tiết: lần đầu gọi 0,99 giây (đi hỏi Open-Meteo), các lần sau 2 ms (từ Redis).

Thử Open-Meteo lỗi (chạy một API tạm với `WEATHER_BASE_URL=http://127.0.0.1:1`, đã có cache cũ rồi xoá cache tươi):

```text
{"data":{"updated_at":"2026-11-03T04:24:38Z","stale":true,"airports":[ ... ]}}   → 200, dữ liệu cũ, stale = true
```

Xoá cả `cache:weather:fresh` và `cache:weather:stale`:

```text
{"error":{"code":"weather_unavailable","message":"Chưa lấy được thời tiết, vui lòng thử lại sau"}}   → 503
```

### Bước 2: Chuyến bay của tôi

Đăng ký một tài khoản (giữ cookie), rồi:

```text
register 201
-- thêm hợp lệ
 [204]
-- trùng
{"error":{"code":"flight_exists","message":"Bạn đã thêm chuyến bay này vào ngày đó rồi"}}
 [409]
-- chuyến không tồn tại + ngày sai + ghế sai
{"error":{"code":"invalid_flight","message":"Thông tin chuyến bay chưa đúng","fields":{"cabin":"Hạng ghế không hợp lệ","code":"Không tìm thấy chuyến bay này","seat":"Số ghế dạng 3A, 12F"}}}
 [400]
-- quá khứ
{"error":{"code":"invalid_flight","message":"Thông tin chuyến bay chưa đúng","fields":{"date":"Chỉ thêm được chuyến từ hôm nay tới 1 năm sau"}}}
 [400]
-- chuyến đang bay hôm nay
 [204]
-- danh sách
58b81662 2026-11-03 VJ 885 12F economy in_air 10:45 lên tàu 10:05 cửa 5
cda5eca8 2026-11-04 VN 220 3A business scheduled 08:00 lên tàu 07:20 cửa 12
-- chưa đăng nhập
401
-- xoá
 [204]
{"error":{"code":"flight_not_found","message":"Không tìm thấy chuyến bay"}}
 [404]
-- limit
 [409]
","message":"Bạn đang theo dõi tối đa 10 chuyến bay. Xoá bớt chuyến cũ rồi thêm lại"}}
 [409]
```

(Mỗi `[xxx]` là mã HTTP.) Đối chiếu:

- `vn220` và ghế `3a` được chuẩn hoá thành `VN 220` và `3A`.
- Thêm lại cùng chuyến cùng ngày: 409 `flight_exists`.
- Dữ liệu sai: lỗi **theo từng ô** (`code`, `seat`, `cabin`), không phải một câu chung chung.
- Ngày quá khứ: lỗi ở ô `date`.
- Lên tàu = giờ cất cánh trừ 40 phút (08:00 → 07:20); cửa ra lấy từ lịch bay.
- Xoá hai lần: lần hai 404 (đã mất).
- Thêm tới chuyến thứ 11: 409 `too_many_flights`.

## Kiểm tra

Xoá tài khoản thử sau khi xong:

```sql
DELETE FROM users WHERE email LIKE 'p10-%';  -- user_flights xoá theo (ON DELETE CASCADE)
```

## Hay gặp lỗi

- **Thấy `stale: true` mãi**: Open-Meteo vẫn lỗi hoặc container không ra được internet. Xem log API dòng `lấy thời tiết lỗi`.
- **`NOAUTH Authentication required` khi dùng `redis-cli`**: Redis của dự án có mật khẩu; chạy trong container: `redis-cli -a "$REDIS_PASSWORD"`.
