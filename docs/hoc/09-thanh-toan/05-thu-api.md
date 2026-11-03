# Bài 9.05: Thử toàn bộ luồng thanh toán bằng curl

> [← Bài trước](04-noi-day-va-doi-soat.md) · [Mục lục](../README.md) · [Bài sau →](06-frontend-thanh-toan.md)

## Mục tiêu

Thử từng tình huống ở bảng bài 9.03 bằng curl: thanh toán thành công, webhook giả mạo / cũ / sai số tiền,
thất bại rồi thử lại, trả ở phiên cũ, trả chậm sau khi hết hạn, trả sau khi đã huỷ, mất webhook.

## Bạn sẽ học

- Tự ký webhook bằng `openssl` để đóng vai cổng thanh toán.
- Giả lập thời gian trôi bằng cách sửa `expires_at`, `created_at` trong database.
- Đọc kết quả để thấy mỗi tình huống kết thúc ở trạng thái nào.

## Viết code

Không có code mới. Lưu thành `thu9.sh` ở **ngoài** repo, chạy `bash thu9.sh` (cần `docker compose`; mất
khoảng 3 phút vì có hai chỗ chờ worker):

```bash
cd /home/phamvanphuc/tnp/airlife
A=localhost:8080/api/v1; H='-H Content-Type:application/json'; O='-H Origin:http://localhost:3000'; M=localhost:8025/api/v1
SECRET=$(grep '^PAYMENT_WEBHOOK_SECRET=' backend/.env | cut -d= -f2)
J() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
PSQL() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<<"$1"; }
sign() { T=$(date +%s); S=$(printf '%s.%s' "$T" "$1" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}'); echo "t=$T,v1=$S"; }
hook() { # hook <body> [chữ ký]  → in mã HTTP
  curl -s -o /dev/null -w "%{http_code}" -X POST $A/webhooks/payment/fake $H -H "X-Payment-Signature: ${2:-$(sign "$1")}" -d "$1"; }
user() { # đăng ký + xác minh; cookie vào file $1
  E="thu9-$1-$(date +%s%N)@example.com"; curl -s -X DELETE $M/messages >/dev/null
  curl -s -o /dev/null -c $1 $H $O -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Chín\"}" $A/auth/register
  sleep 2; ID=$(curl -s $M/messages | J "d['messages'][0]['ID']")
  T=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
  curl -s -o /dev/null $H $O -d "{\"token\":\"$T\"}" $A/auth/verify-email; }
curl -s $A/products/tour-da-lat-san-may-3n2d/departures > av.json
DEP=$(python3 -c "import json;print(json.load(open('av.json'))['data']['departures'][1]['id'])")
FARE=$(python3 -c "import json;print(json.load(open('av.json'))['data']['fares'][0]['id'])")
booking() { # booking <cookie> → in mã đơn, đã điền hành khách (awaiting_payment)
  C=$(curl -s -b $1 $O $H -H "Idempotency-Key: k-$RANDOM$RANDOM" -d "{\"departure_id\":\"$DEP\",\"fare_id\":\"$FARE\",\"adults\":1,\"children\":0}" $A/me/bookings | J "d['data']['code']")
  curl -s -o /dev/null -b $1 $O $H -X PUT -d '{"contact_name":"Thu Chín","contact_phone":"0901234567","contact_email":"thu9@example.com","passengers":[{"full_name":"Thu Chin","birth_date":"1990-01-01"}]}' $A/me/bookings/$C/details
  echo $C; }
pay() { curl -s -b $1 $O -X POST $A/me/bookings/$2/pay | J "d['data']['payment_url'].split('/')[-1] if 'data' in d else d['error']['code']"; }
fake() { curl -s -b $1 $O $H -d "{\"result\":\"$3\"}" $A/dev/fake-gateway/$2 | J "d['data']['return_url'] if 'data' in d else d['error']['code']"; }
status() { curl -s -b $1 $A/me/bookings/$2 | J "d['data']['status'], d['data']['payment']"; }

echo "=== 1. Thanh toán thành công"
user a.txt; C1=$(booking a.txt); echo "đơn $C1:" $(status a.txt $C1)
PSQL "UPDATE bookings SET expires_at = now() + interval '30 seconds' WHERE code = '$C1'" >/dev/null
TX=$(pay a.txt $C1); echo "phiên $TX"
curl -s -b a.txt $A/me/bookings/$C1 | J "'giữ chỗ sau khi bấm Thanh toán còn (giây):', d['data']['expires_in']"
curl -s $A/dev/fake-gateway/$TX | J "d['data']['amount'], d['data']['status']"
curl -s -X DELETE $M/messages >/dev/null
fake a.txt $TX succeeded
echo "đơn sau webhook:" $(status a.txt $C1)
sleep 2; curl -s $M/messages | J "[m['Subject'] for m in d['messages']]"
fake a.txt $TX succeeded >/dev/null; echo "bấm trả lần 2 ở cổng: payment_events =" $(PSQL "SELECT count(*) FROM payment_events e JOIN payments p ON p.id = e.payment_id WHERE p.provider_txn = '$TX'")
curl -s -b a.txt $O -X POST $A/me/bookings/$C1/pay | J "'trả đơn đã xác nhận:', d['error']['code']"

echo "=== 2. Webhook giả mạo / trùng / sai số tiền"
user b.txt; C2=$(booking b.txt); TX2=$(pay b.txt $C2); PC2=$(PSQL "SELECT code FROM payments WHERE provider_txn='$TX2'")
BODY="{\"event_id\":\"evt-$RANDOM$RANDOM\",\"payment_code\":\"$PC2\",\"txn\":\"$TX2\",\"status\":\"succeeded\",\"amount\":2490000}"
echo "không chữ ký:" $(curl -s -o /dev/null -w "%{http_code}" -X POST $A/webhooks/payment/fake $H -d "$BODY")
echo "chữ ký sai:  " $(hook "$BODY" "t=$(date +%s),v1=$(printf 'x%.0s' {1..64})")
OLD=$(( $(date +%s) - 3600 )); OLDSIG="t=$OLD,v1=$(printf '%s.%s' "$OLD" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')"
echo "ký đúng nhưng cũ 1 giờ (replay):" $(hook "$BODY" "$OLDSIG")
echo "cổng không tồn tại:" $(curl -s -o /dev/null -w "%{http_code}" -X POST $A/webhooks/payment/vnpay $H -d "$BODY")
BAD="${BODY/2490000/1000}"
echo "sai số tiền (1.000₫):" $(hook "$BAD") "→" $(PSQL "SELECT status||' '||failure_reason||' refund='||refund_required FROM payments WHERE code='$PC2'") "| đơn:" $(status b.txt $C2)
echo "=== 3. Trả không được rồi thử lại; trả ở phiên cũ"
user c.txt; C3=$(booking c.txt); TX3=$(pay c.txt $C3); fake c.txt $TX3 failed >/dev/null
echo "sau khi thất bại:" $(status c.txt $C3)
TX3B=$(pay c.txt $C3); echo "phiên mới $TX3B (khác phiên cũ: $([ "$TX3" != "$TX3B" ] && echo có))"
user c2.txt; C3B=$(booking c2.txt); TXA=$(pay c2.txt $C3B); TXB=$(pay c2.txt $C3B)   # mở phiên thứ hai: phiên đầu bị thay
echo "các phiên của đơn $C3B:" $(PSQL "SELECT string_agg(p.status, ',' ORDER BY p.created_at) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.code = '$C3B'")
fake c2.txt $TXA succeeded >/dev/null   # khách lỡ trả ở tab cũ: tiền đã đi thật
echo "trả ở phiên cũ (đã bị thay):" $(status c2.txt $C3B)
fake c2.txt $TXB succeeded >/dev/null   # rồi lại trả ở phiên mới: trả trùng
echo "trả thêm ở phiên mới:" $(PSQL "SELECT string_agg(p.status||'/'||COALESCE(p.failure_reason,'-')||'/refund='||p.refund_required, ' | ' ORDER BY p.created_at) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.code = '$C3B'")
echo "=== 4. Trả chậm sau khi hết hạn (worker đã trả chỗ)"
user d.txt; C4=$(booking d.txt); TX4=$(pay d.txt $C4)
LEFT0=$(curl -s $A/products/tour-da-lat-san-may-3n2d/departures | J "d['data']['departures'][1]['seats'][0]['left']")
PSQL "UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE code = '$C4'" >/dev/null
sleep 35; echo "worker hết hạn:" $(status d.txt $C4) "| chỗ còn $LEFT0 →" $(curl -s $A/products/tour-da-lat-san-may-3n2d/departures | J "d['data']['departures'][1]['seats'][0]['left']")
fake d.txt $TX4 succeeded >/dev/null
echo "khách trả chậm:" $(status d.txt $C4) "| chỗ còn" $(curl -s $A/products/tour-da-lat-san-may-3n2d/departures | J "d['data']['departures'][1]['seats'][0]['left']")
echo "=== 5. Huỷ rồi mới trả"
user e.txt; C5=$(booking e.txt); TX5=$(pay e.txt $C5)
curl -s -o /dev/null -b e.txt $O -X POST $A/me/bookings/$C5/cancel
fake e.txt $TX5 succeeded >/dev/null
echo "đơn:" $(status e.txt $C5) "| payment:" $(PSQL "SELECT status||' '||COALESCE(failure_reason,'')||' refund='||refund_required FROM payments WHERE provider_txn='$TX5'")
echo "=== 6. Mất webhook → đối soát (worker chạy 2 phút/lần)"
user f.txt; C6=$(booking f.txt); TX6=$(pay f.txt $C6)
docker compose exec -T redis redis-cli -a airlife --no-auth-warning HSET fakegw:$TX6 status succeeded >/dev/null   # cổng ghi nhận đã trả, nhưng KHÔNG gọi webhook
PSQL "UPDATE payments SET created_at = now() - interval '5 minutes' WHERE provider_txn = '$TX6'" >/dev/null
echo "trước đối soát:" $(status f.txt $C6)
for i in $(seq 1 26); do S=$(curl -s -b f.txt $A/me/bookings/$C6 | J "d['data']['status']"); [ "$S" = confirmed ] && break; sleep 5; done
echo "sau đối soát (chờ ~$((i*5))s):" $(status f.txt $C6)
docker compose logs --since 3m worker 2>&1 | grep "đối soát" | tail -1 | sed 's/.*msg=/msg=/'
echo "=== Cần hoàn tiền:"; PSQL "SELECT count(*), string_agg(failure_reason, ',') FROM payments WHERE refund_required AND user_id IN (SELECT id FROM users WHERE email LIKE 'thu9-%')"
rm -f a.txt b.txt c.txt c2.txt d.txt e.txt f.txt av.json
```

Kết quả thật:

```text
=== 1. Thanh toán thành công
đơn BK-3542HQFD: awaiting_payment None
phiên FK-NKDUNM67
giữ chỗ sau khi bấm Thanh toán còn (giây): 600
2490000 pending
http://localhost:3000/dat-cho/BK-3542HQFD?tt=1
đơn sau webhook: confirmed {'status': 'succeeded', 'refund_required': False}
['Đặt chỗ của bạn đã được xác nhận']
bấm trả lần 2 ở cổng: payment_events = 1
trả đơn đã xác nhận: booking_not_payable
=== 2. Webhook giả mạo / trùng / sai số tiền
không chữ ký: 400
chữ ký sai:   400
ký đúng nhưng cũ 1 giờ (replay): 400
cổng không tồn tại: 404
sai số tiền (1.000₫): 204 → failed amount_mismatch refund=true | đơn: awaiting_payment {'status': 'failed', 'refund_required': True}
=== 3. Trả không được rồi thử lại; trả ở phiên cũ
sau khi thất bại: awaiting_payment {'status': 'failed', 'refund_required': False}
phiên mới FK-7RFX4XUH (khác phiên cũ: có)
các phiên của đơn BK-95XKYT74: expired,pending
trả ở phiên cũ (đã bị thay): confirmed {'status': 'pending', 'refund_required': False}
trả thêm ở phiên mới: succeeded/-/refund=false | failed/booking_confirmed/refund=true
=== 4. Trả chậm sau khi hết hạn (worker đã trả chỗ)
worker hết hạn: expired {'status': 'pending', 'refund_required': False} | chỗ còn 15 → 16
khách trả chậm: confirmed {'status': 'succeeded', 'refund_required': False} | chỗ còn 15
=== 5. Huỷ rồi mới trả
đơn: cancelled {'status': 'failed', 'refund_required': True} | payment: failed booking_cancelled refund=true
=== 6. Mất webhook → đối soát (worker chạy 2 phút/lần)
trước đối soát: awaiting_payment {'status': 'pending', 'refund_required': False}
sau đối soát (chờ ~50s): confirmed {'status': 'succeeded', 'refund_required': False}
msg="đối soát thanh toán: đã áp kết quả" khoan=1
=== Cần hoàn tiền:
3|booking_confirmed,amount_mismatch,booking_cancelled
```

Đọc kết quả:

1. **Thành công**: bấm "Thanh toán" khi đơn chỉ còn 30 giây giữ chỗ thì được kéo lên **600 giây** (10 phút
   cho khách nhập thẻ). Webhook → đơn `confirmed`, Mailpit có thư. Bấm trả lần hai ở cổng: `payment_events`
   vẫn 1 dòng. Trả lại đơn đã xác nhận: `booking_not_payable`.
2. **Giả mạo**: không chữ ký, chữ ký sai, ký đúng nhưng mốc thời gian cũ 1 giờ (replay) đều `400`; cổng
   không tồn tại `404`. Webhook ký đúng nhưng **số tiền 1.000₫** thay vì 2.490.000₫: trả `204` (đã nhận)
   nhưng khoản thành `failed / amount_mismatch / refund=true`, đơn **vẫn chờ thanh toán**, không được xác nhận.
3. **Thất bại rồi thử lại**: khoản đầu `failed`, đơn vẫn chờ; bấm thanh toán lại ra phiên mới. Mở phiên
   thứ hai thì phiên đầu thành `expired`; khách lỡ trả ở phiên cũ (`expired`) → tiền đã đi thật, đơn **vẫn
   được xác nhận**. Khách trả tiếp ở phiên mới (trả trùng): khoản đó `failed / booking_confirmed /
   refund=true`: không xác nhận lần hai, đánh dấu hoàn tiền.
4. **Trả chậm**: sửa hạn giữ chỗ thành quá khứ, worker trả chỗ (15 → 16). Khách trả chậm: còn chỗ nên lấy
   lại được (16 → 15) và đơn `confirmed`.
5. **Huỷ rồi mới trả**: đơn vẫn `cancelled`, khoản `failed / booking_cancelled / refund=true`.
6. **Mất webhook**: cổng ghi nhận đã trả nhưng không gọi webhook. Đơn kẹt `awaiting_payment` cho tới khi
   worker đối soát (vòng 2 phút) hỏi cổng và áp kết quả: `confirmed`, log `đối soát thanh toán: đã áp kết quả`.

Cuối cùng 3 khoản `refund_required` (`amount_mismatch`, `booking_cancelled`, `booking_confirmed`): đúng
danh sách việc của nhân viên hoàn tiền.

Dọn dữ liệu thử:

```sql
-- make psql
DELETE FROM payment_events;
DELETE FROM payments;
DELETE FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'thu9-%');
DELETE FROM users WHERE email LIKE 'thu9-%';
UPDATE departure_seats s SET taken = COALESCE((
  SELECT sum(adults + children) FROM bookings b
  WHERE b.departure_id = s.departure_id AND b.fare_id = s.fare_id
    AND b.status IN ('held', 'awaiting_payment', 'confirmed')), 0);
```

(Hai dòng `DELETE FROM payment_events/payments` xoá hết khoản thanh toán: chỉ làm khi dev.)

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Script thử báo `column reference "status" is ambiguous` | `string_agg(status, …)` khi `JOIN` hai bảng đều có cột `status`; viết `p.status` |
| Kịch bản "trả ở phiên cũ" không tạo ra `expired` | Phiên đó đã `failed` (khách bấm thất bại) chứ chưa bị thay. Muốn có `expired`, mở phiên thứ hai khi phiên đầu còn `pending` |
| Đăng ký tài khoản thử trả `429` | Giới hạn 10 lần đăng ký / giờ / IP (bài 4.04); xoá khoá `auth:register:*` trong Redis khi dev |
| Đơn mới nhất báo "đang chờ" dù đã thanh toán | `GetLatestPayment` phải ưu tiên khoản `succeeded` (bài 9.01) |
