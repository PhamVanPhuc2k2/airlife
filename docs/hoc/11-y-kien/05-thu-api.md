# Bài 11.05: Thử API Ý kiến bằng curl

> [← Bài trước](04-goi-y-va-turnstile.md) · [Mục lục](../README.md) · [Bài sau →](06-frontend-y-kien.md)

## Mục tiêu

Chạy từng API, kể cả các tình huống lỗi, và đọc kết quả thật.

## Bạn sẽ học

- Thử đủ đường: thành công, sai dữ liệu, thiếu quyền, trùng, giới hạn tốc độ.
- Thử Turnstile ở cả bốn nhánh bằng cách đổi cấu hình rồi `make restart s=api`.

## Viết code

Không viết code mới. Đăng ký hai tài khoản `A`, `B`, rồi đánh dấu đã xác minh email (dev: tắt luồng email bằng SQL):

```bash
A=http://localhost:8080/api/v1
curl -s -c a.jar -XPOST $A/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@test.local","password":"Matkhau-Dai-123","display_name":"A"}'
docker compose exec -T postgres psql -U airlife -d airlife \
  -c "update users set email_verified_at=now() where email='a@test.local'"
```

## Kiểm tra

**Chưa xác minh email** → 403:

```json
{"error":{"code":"email_not_verified","message":"Bạn cần xác minh email trước khi tham gia"}}
```

**Sai dữ liệu** (route "x", rating 9, nội dung ngắn) → 400, báo đủ ba ô:

```json
{"error":{"code":"validation_failed","message":"Thông tin chưa hợp lệ","fields":{"body":"Nội dung từ 10 đến 2000 ký tự","rating":"Chọn từ 1 đến 5 sao","route":"Chặng bay từ 3 đến 40 ký tự, ví dụ SGN → HAN"}}}
```

**Đăng hợp lệ** với route `"SGN  →  HAN"` → 201, route đã chuẩn hoá thành `SGN → HAN`.

**Thích hai lần, bỏ thích hai lần** (bấm đôi không đếm đôi): `1, 1, 0, 0`.

**B xoá bài của A** → 403 `forbidden`. **A xoá** → 204; xoá lần hai → 404.

**Khảo sát** (A bình chọn):

| Tình huống | Kết quả |
|---|---|
| Chưa đăng nhập | 401 |
| `option_id` của khảo sát khác | 400 `invalid_option` |
| Hợp lệ | 204 |
| Bình chọn lần hai | 409 `already_voted` |
| B bình chọn cùng phương án | 204, tổng thành 2 phiếu, phương án đó 100% |

**Góp ý và Turnstile:**

| Tình huống | Kết quả |
|---|---|
| Không có header `X-Turnstile-Token` | 400 `captcha_failed` |
| Có token, secret là khoá thử "luôn cho qua" | 204 |
| Sai ô (`topic`, `rating`, `body`, `flight_code`, `email`) | 400, báo từng ô |
| Gửi lần thứ 6 trong một giờ | 429 `too_many_feedbacks` |
| `TURNSTILE_SECRET=2x0000000000000000000000000000000AA` | 400 `captcha_failed` |
| `TURNSTILE_VERIFY_URL=http://127.0.0.1:1/x` (không tới được) | 503 `captcha_unavailable` |
| `APP_ENV=production` + khoá thử | API dừng: "TURNSTILE_SECRET production phải là khoá thật…" |

Thử nhánh cấu hình bằng cách thêm dòng vào `backend/.env`, `make restart s=api`, gọi `curl`, rồi **trả `.env` về như cũ**.

Dọn dữ liệu thử: `delete from feedbacks; delete from users where email like '%@test.local';` (bài viết, phiếu và lượt thích của họ tự xoá theo `ON DELETE CASCADE`).

## Hay gặp lỗi

- **`NOAUTH Authentication required` khi xoá khoá giới hạn trong Redis**: thêm `-a <mật khẩu>` cho `redis-cli` (mật khẩu ở `.env`, mặc định `airlife`).
- **Lần thử thứ 6 báo 429 dù chỉ gửi 5 lần**: các lần gửi thử trước đó đã tính vào cửa sổ một giờ của cùng IP. Xoá khoá `opinion:rate:feedback:*` để thử lại.
