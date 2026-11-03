-- Tiện ích: sân bay, chuyến bay, chuyến bay của người dùng, gói Wi-Fi (Phần 10).

-- name: ListAirports :many
SELECT code, city, name, country, lat, lon, timezone FROM airports ORDER BY code;

-- name: ListFlights :many
SELECT code, airline, origin, destination, dep_local, duration_minutes, delay_minutes, gate, cancelled
FROM flights;

-- name: GetFlightByCode :one
SELECT id, code, airline, origin, destination, dep_local, duration_minutes, delay_minutes, gate, cancelled
FROM flights WHERE code = $1;

-- name: ListWifiPlans :many
SELECT id, name, description, price, popular FROM wifi_plans ORDER BY sort_order, id;

-- Chuyến bay của người dùng từ ngày from_date (ngày hôm qua tính theo giờ VN để vẫn thấy chuyến đang bay)
-- name: ListUserFlights :many
SELECT uf.id, uf.flight_date, uf.seat, uf.cabin, f.code
FROM user_flights uf
JOIN flights f ON f.id = uf.flight_id
WHERE uf.user_id = sqlc.arg('user_id') AND uf.flight_date >= sqlc.arg('from_date')::date
ORDER BY uf.flight_date, f.dep_local;

-- name: CountUserFlights :one
SELECT count(*) FROM user_flights
WHERE user_id = sqlc.arg('user_id') AND flight_date >= sqlc.arg('from_date')::date;

-- Thêm chuyến bay. Trùng (người này, chuyến này, ngày này) thì 0 dòng, không báo lỗi.
-- name: AddUserFlight :execrows
INSERT INTO user_flights (user_id, flight_id, flight_date, seat, cabin)
VALUES (sqlc.arg('user_id'), sqlc.arg('flight_id'), sqlc.arg('flight_date'), sqlc.arg('seat'), sqlc.arg('cabin'))
ON CONFLICT (user_id, flight_id, flight_date) DO NOTHING;

-- Xoá theo id VÀ user_id: không xoá nhầm chuyến bay của người khác
-- name: DeleteUserFlight :execrows
DELETE FROM user_flights WHERE id = $1 AND user_id = $2;
