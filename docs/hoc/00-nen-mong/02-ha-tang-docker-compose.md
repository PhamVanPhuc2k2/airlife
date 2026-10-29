# Bài 0.02: Hạ tầng dev bằng Docker Compose

> [← Bài trước](01-khoi-tao-repo.md) · [Mục lục](../README.md) · [Bài sau →](03-module-go-va-cau-truc.md)

## Mục tiêu

Một lệnh chạy được PostgreSQL 18, Redis 8 và RabbitMQ 4, dữ liệu giữ lại sau khi tắt.
Đây là **bản khởi đầu** của `docker-compose.yml`; bài 0.10 thêm service `api`, `worker`, `migrate`.

## Bạn sẽ học

- Vì sao chạy mọi thứ bằng Docker.
- **Ghi rõ phiên bản patch** của image (`postgres:18.6-alpine`), không dùng `latest`.
- `healthcheck` + `--wait`: lệnh chỉ xong khi dịch vụ **thật sự** nhận kết nối, không chỉ là container đã bật.
- Volume có tên giữ dữ liệu qua những lần `down` / `up`.

## Viết code

### Vì sao chạy bằng Docker

Cài PostgreSQL, Redis, RabbitMQ thẳng lên máy thì mỗi người một phiên bản, máy dev khác
production, "máy tôi chạy được mà". Docker cố định phiên bản trong một file commit vào git:
ai clone về chạy `make up` là có môi trường giống hệt. API và worker cũng chạy trong Docker
(bài 0.10), với `air` để sửa code là chạy lại ngay.

### Vì sao ghi rõ phiên bản

Tag `latest` hay `18` tự trôi lên bản mới mỗi lần `docker pull`. Hôm nay bạn và đồng nghiệp
chạy hai bản khác nhau mà không biết. Ghi `18.6` thì mọi máy giống nhau, và khi có bản vá bảo mật
bạn **chủ động** sửa số trong file, commit lại, ai cũng thấy.

Phiên bản trong bài là bản mới nhất lúc viết (29/10/2026). Trước khi gõ, xem trang Docker Hub của
[postgres](https://hub.docker.com/_/postgres), [redis](https://hub.docker.com/_/redis),
[rabbitmq](https://hub.docker.com/_/rabbitmq); có bản patch mới hơn thì dùng bản đó.

### `docker-compose.yml` (bản khởi đầu, ở gốc repo)

Gõ phần hạ tầng trước. Bài 0.10 thêm khối `x-backend` và các service `api`, `worker`, `migrate`
vào **đầu** mục `services`, cùng hai volume `go-mod`, `go-cache`.

```yaml
# Môi trường dev: mọi thứ chạy trong Docker.
# Mật khẩu, cổng: đọc từ file .env ở gốc repo (Compose tự đọc), không có thì dùng mặc định.
name: airlife

services:
  postgres:
    image: postgres:18.6-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-airlife}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-airlife}
      POSTGRES_DB: ${POSTGRES_DB:-airlife}
    # 127.0.0.1: chỉ máy bạn kết nối được (cho DBeaver, TablePlus…), máy khác trong mạng LAN thì không.
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      # Postgres 18 lưu dữ liệu theo thư mục con có số phiên bản, nên mount vào /var/lib/postgresql
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8.10.3-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:-airlife}"]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:-airlife}
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD} --no-auth-warning ping | grep PONG"]
      interval: 5s
      timeout: 3s
      retries: 10

  rabbitmq:
    image: rabbitmq:4.4.0-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-airlife}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-airlife}
    ports:
      - "127.0.0.1:${RABBITMQ_UI_PORT:-15672}:15672" # trang quản trị: http://localhost:15672
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  postgres-data:
  redis-data:
  rabbitmq-data:
```

Điểm chính:

- `${POSTGRES_USER:-airlife}`: đọc biến, không có thì dùng `airlife`. Không cần file `.env` vẫn chạy được.
- `$$` trong `healthcheck`: Compose coi `$` là biến của nó; `$$` để giữ nguyên một dấu `$`,
  biến được đọc **bên trong** container.
- **`127.0.0.1:` trước cổng**: thiếu nó, Docker mở cổng cho **mọi** máy trong mạng (quán cà phê,
  công ty) kết nối vào DB của bạn. Docker còn tự thêm luật iptables vượt qua cả tường lửa `ufw`.
- **PostgreSQL 18 đổi chỗ lưu dữ liệu**: bản cũ mount vào `/var/lib/postgresql/data`, bản 18
  mount vào `/var/lib/postgresql`. Chép cấu hình từ bài hướng dẫn cũ là dính lỗi ở đây.
- Redis bật `--appendonly yes` để không mất dữ liệu khi container khởi động lại, và đặt
  `--requirepass` vì Redis mặc định không có mật khẩu.
- RabbitMQ không mở cổng 5672 ra máy: chỉ api/worker (cùng mạng Docker) cần kết nối. Image
  `-management` có trang quản trị web ở cổng 15672.

### `.env.example` (ở gốc repo)

Chỉ cần khi muốn đổi mật khẩu hoặc cổng (ví dụ máy đã có PostgreSQL chiếm cổng 5432). `UID`,
`GID`, `API_PORT` dùng từ bài 0.10.

```dotenv
# Biến cho docker-compose.yml. Copy thành .env (cùng thư mục) nếu muốn đổi mật khẩu/cổng mặc định.
# Docker Compose tự đọc file .env nằm cạnh docker-compose.yml.

# UID/GID của bạn (lệnh: id -u, id -g). Container dev chạy bằng user này để file
# sinh ra trong backend/ không bị thuộc root.
UID=1000
GID=1000

POSTGRES_USER=airlife
POSTGRES_PASSWORD=airlife
POSTGRES_DB=airlife
POSTGRES_PORT=5432

REDIS_PASSWORD=airlife
REDIS_PORT=6379

RABBITMQ_USER=airlife
RABBITMQ_PASSWORD=airlife
RABBITMQ_UI_PORT=15672

API_PORT=8080
```

Docker Compose tự đọc file `.env` nằm **cùng thư mục** với `docker-compose.yml`. Muốn đổi thì
`cp .env.example .env` rồi sửa.

## Kiểm tra

```bash
docker compose up -d --wait
docker compose ps
```

Cả ba dịch vụ phải ở trạng thái `running (healthy)`. Thử từng cái:

```bash
docker compose exec postgres psql -U airlife -c "SELECT version();"
docker compose exec redis redis-cli -a airlife ping   # PONG
```

Mở http://localhost:15672, đăng nhập `airlife` / `airlife`: thấy trang quản trị RabbitMQ.

Kiểm tra dữ liệu còn sau khi tắt:

```bash
docker compose exec postgres psql -U airlife -c "CREATE TABLE thu (id int);"
docker compose down
docker compose up -d --wait
docker compose exec postgres psql -U airlife -c "\dt"   # vẫn thấy bảng thu
docker compose exec postgres psql -U airlife -c "DROP TABLE thu;"
```

Bài 0.11 rút gọn các lệnh này thành `make up`, `make down`, `make psql`.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `port is already allocated` / `address already in use` | Máy đã có PostgreSQL/Redis chạy sẵn. Tắt nó (`sudo systemctl stop postgresql`) hoặc đổi cổng trong `.env` |
| PostgreSQL báo lỗi về `/var/lib/postgresql/data` | Đang mount kiểu cũ của bản ≤ 17. Sửa volume thành `/var/lib/postgresql` |
| Đổi `POSTGRES_PASSWORD` nhưng mật khẩu cũ vẫn dùng được | Biến này chỉ có tác dụng **lần đầu** tạo DB. Xoá volume để tạo lại: `docker compose down -v` (mất hết dữ liệu dev) |
| `--wait` treo lâu rồi báo unhealthy | Xem log: `docker compose logs rabbitmq`. RabbitMQ khởi động chậm nhất, lần đầu có thể mất 20–30 giây |
