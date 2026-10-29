# Bài 0.10: Dockerfile nhiều target, chạy api/worker trong Docker với air

> [← Bài trước](09-cmd-api-va-worker.md) · [Mục lục](../README.md) · [Bài sau →](11-lint-vuln-makefile.md)

## Mục tiêu

`docker compose up` chạy cả hệ thống: hạ tầng + api + worker. Sửa file `.go` trên máy là
container tự build và chạy lại. Cùng Dockerfile đó build được image production chỉ ~25 MB.

## Bạn sẽ học

- **Multi-stage build**: một Dockerfile, nhiều `target` cho dev và production.
- Thứ tự `COPY` để tận dụng cache của Docker.
- Mount code vào container + air = hot reload trong Docker.
- Chạy container bằng UID của mình để không sinh file thuộc root.
- Trong mạng Docker, các service gọi nhau bằng **tên service**, không phải `localhost`.

## Viết code

### Bước 1: `backend/Dockerfile`

```dockerfile
# Một Dockerfile, nhiều "target" (build stage):
#   dev     → chạy api/worker bằng air, mount code từ máy vào, sửa là chạy lại (docker-compose.yml)
#   api     → image production chỉ chứa binary api
#   worker  → image production chỉ chứa binary worker
#
# Build production: docker build --target api -t airlife-api ./backend

# ---------- base: Go + thư viện đã tải ----------
FROM golang:1.27.3-alpine3.23 AS base
WORKDIR /app
# Chép go.mod, go.sum trước rồi tải thư viện, SAU ĐÓ mới chép code.
# Docker cache theo từng lớp: sửa code không đổi go.mod thì lớp tải thư viện được dùng lại,
# build nhanh hơn nhiều.
COPY go.mod go.sum ./
RUN go mod download

# ---------- dev: hot reload bằng air ----------
FROM base AS dev
RUN go install github.com/air-verse/air@v1.67.4
# Container dev chạy bằng UID của bạn (xem docker-compose.yml) để file air sinh ra trong
# backend/tmp không bị thuộc root. User đó cần quyền ghi vào cache của Go.
#   GOCACHE: cache build của Go.  XDG_CACHE_HOME: cache của golangci-lint và các công cụ khác
#   (mặc định nằm trong $HOME, mà user theo UID không có thư mục home).
ENV GOCACHE=/go/cache XDG_CACHE_HOME=/go/cache
RUN mkdir -p /go/cache /go/pkg/mod && chmod -R 777 /go
# Code không COPY vào image dev: docker-compose.yml mount ./backend vào /app.
CMD ["air", "-c", ".air.api.toml"]

# ---------- build: biên dịch binary production ----------
FROM base AS build
COPY . .
# CGO_ENABLED=0: binary tĩnh, không cần thư viện C, chạy được trên image distroless.
# -trimpath: bỏ đường dẫn máy build khỏi binary. -s -w: bỏ thông tin debug, binary nhỏ hơn.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

# ---------- api, worker: image production ----------
# distroless: không có shell, không có trình quản lý gói, chỉ có binary của ta.
# Kẻ tấn công chiếm được tiến trình cũng không có công cụ gì để dùng tiếp.
# :nonroot chạy bằng user không phải root.
FROM gcr.io/distroless/static-debian13:nonroot AS api
COPY --from=build /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]

FROM gcr.io/distroless/static-debian13:nonroot AS worker
COPY --from=build /out/worker /worker
ENTRYPOINT ["/worker"]
```

Điểm chính:

- **Ba nhóm target**: `dev` (có Go, air, chạy code mount từ máy), `api` và `worker` (production,
  chỉ có binary). `docker compose` dùng `target: dev`; khi triển khai thì build `--target api`.
- **`COPY go.mod go.sum` rồi `go mod download`, sau đó mới `COPY . .`**: Docker cache theo từng
  lớp, lớp nào đầu vào không đổi thì dùng lại. Sửa code mà không đổi `go.mod` thì không phải tải
  lại thư viện. Đảo thứ tự (`COPY . .` trước) là sửa một dòng code cũng tải lại tất cả.
- **`chmod -R 777 /go`**: container dev chạy bằng UID của bạn (bước 2), user đó phải ghi được
  vào cache của Go. Chỉ áp dụng cho image dev, image production không có thư mục này.
- **distroless `:nonroot`**: image production không có shell, không có `apt`, không chạy bằng root.

### Bước 2: Thêm api, worker, migrate vào `docker-compose.yml`

Bản đầy đủ (phần hạ tầng giữ nguyên như bài 0.02):

```yaml
# Môi trường dev: mọi thứ chạy trong Docker.
#   make up      → chạy hết (hạ tầng + api + worker), api ở http://localhost:8080
#   make logs    → xem log
#   make down    → tắt
#
# api và worker chạy bằng air bên trong container, code mount từ ./backend vào:
# sửa file .go trên máy là container tự build và chạy lại.
#
# Mật khẩu, cổng: đọc từ file .env ở gốc repo (Compose tự đọc), không có thì dùng mặc định.
name: airlife

x-backend: &backend
  build:
    context: ./backend
    target: dev
  # Chạy bằng UID/GID của bạn để file sinh ra trong backend/tmp không thuộc root.
  user: "${UID:-1000}:${GID:-1000}"
  restart: unless-stopped
  volumes:
    - ./backend:/app
    - go-mod:/go/pkg/mod # thư viện Go đã tải, giữ lại giữa các lần chạy
    - go-cache:/go/cache # cache build, lần sau build nhanh hơn
  # backend/.env được mount vào /app/.env cùng với code, viper tự đọc lúc khởi động
  # (sửa xong: make restart s=api). Không dùng env_file: biến nạp kiểu đó chỉ cập nhật khi
  # tạo lại container, và lại đè lên giá trị mới trong file, rất dễ nhầm.
  #
  # Địa chỉ hạ tầng đặt ở đây (không đặt trong backend/.env) để luôn khớp với mật khẩu
  # của các service bên dưới. Trong mạng Docker, gọi nhau bằng tên service: postgres, redis…
  environment:
    POSTGRES_URL: postgres://${POSTGRES_USER:-airlife}:${POSTGRES_PASSWORD:-airlife}@postgres:5432/${POSTGRES_DB:-airlife}?sslmode=disable
    REDIS_ADDR: redis:6379
    REDIS_PASSWORD: ${REDIS_PASSWORD:-airlife}
    RABBITMQ_URL: amqp://${RABBITMQ_USER:-airlife}:${RABBITMQ_PASSWORD:-airlife}@rabbitmq:5672/
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy

services:
  api:
    <<: *backend
    command: ["air", "-c", ".air.api.toml"]
    ports:
      - "127.0.0.1:${API_PORT:-8080}:8080"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 5s
      timeout: 3s
      retries: 30 # lần đầu air phải build, có thể mất gần một phút
      start_period: 10s

  worker:
    <<: *backend
    command: ["air", "-c", ".air.worker.toml"]

  # Chạy migration: make migrate. profiles: ["tools"] để `docker compose up` không tự chạy nó.
  migrate:
    image: migrate/migrate:v4.20.1
    profiles: ["tools"]
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - ./backend/migrations:/migrations
    entrypoint:
      - migrate
      - -path=/migrations
      - -database=postgres://${POSTGRES_USER:-airlife}:${POSTGRES_PASSWORD:-airlife}@postgres:5432/${POSTGRES_DB:-airlife}?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy

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
  go-mod:
  go-cache:
```

Điểm chính:

- **`x-backend: &backend`** và **`<<: *backend`**: khai báo phần chung một lần (YAML anchor),
  api và worker cùng dùng, chỉ khác `command`. Compose bỏ qua các khoá bắt đầu bằng `x-`.
- **`./backend:/app`**: code trên máy được mount vào container. Air trong container thấy file
  thay đổi là build lại. File `backend/.env` cũng được mount theo, viper đọc ở `/app/.env`.
- **`user: "${UID:-1000}:${GID:-1000}"`**: thiếu dòng này, air chạy bằng root và file trong
  `backend/tmp/` thuộc root, máy bạn không xoá được nếu không `sudo`.
- **`environment:`** đặt địa chỉ hạ tầng: `postgres:5432`, `redis:6379`, `rabbitmq:5672`. Trong
  container, `localhost` là **chính container đó**, không phải máy bạn. Các container trong
  cùng compose gọi nhau bằng tên service. Đặt ở đây (không đặt trong `backend/.env`) để mật khẩu
  luôn khớp với service bên dưới.
- **Không dùng `env_file`**: biến nạp kiểu đó chỉ cập nhật khi **tạo lại** container, và lại đè
  lên giá trị mới trong file `.env` (biến môi trường ưu tiên hơn file, bài 0.04). Sửa `.env`,
  restart mà không thấy thay đổi là lỗi rất khó hiểu.
- **`depends_on` + `condition: service_healthy`**: api chỉ khởi động khi DB đã sẵn sàng.
- **`healthcheck` của api** gọi `/healthz` bằng `wget` (alpine có sẵn). `retries: 30` vì lần
  đầu air phải tải thư viện và build.
- **`migrate`** dùng image chính thức `migrate/migrate`, `profiles: ["tools"]` để `docker compose up`
  không tự chạy nó; chỉ chạy khi gọi `docker compose run --rm migrate ...` (bài 0.12).
- **Volume `go-mod`, `go-cache`**: giữ thư viện và cache build giữa các lần chạy. Không có thì
  mỗi lần tạo lại container là tải lại từ đầu.

### Bước 3: Air

Air theo dõi file và build lại. Hai file cấu hình cho hai chương trình:

#### `backend/.air.api.toml`

```toml
# Hot reload cho API: sửa file .go → air build lại và chạy lại.
# Chạy: cd backend && air -c .air.api.toml
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  entrypoint = ["./tmp/api"]
  include_ext = ["go"]
  include_dir = ["cmd", "internal", "pkg"]
  # Không theo dõi cmd/worker: sửa worker không cần build lại api.
  exclude_dir = ["tmp", "migrations", "cmd/worker"]
  # Chờ 500ms sau lần lưu cuối mới build, tránh build nhiều lần khi lưu hàng loạt file.
  delay = 500
  # Gửi SIGINT để api tắt êm (graceful shutdown) trước khi chạy bản mới.
  send_interrupt = true
  kill_delay = "5s"
  stop_on_error = true

[log]
  time = false

[misc]
  clean_on_exit = true
```

#### `backend/.air.worker.toml`

```toml
# Hot reload cho worker. Chạy: cd backend && air -c .air.worker.toml
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/worker ./cmd/worker"
  entrypoint = ["./tmp/worker"]
  include_ext = ["go"]
  include_dir = ["cmd", "internal", "pkg"]
  exclude_dir = ["tmp", "migrations", "cmd/api"]
  delay = 500
  send_interrupt = true
  kill_delay = "5s"
  stop_on_error = true

[log]
  time = false

[misc]
  clean_on_exit = true
```

- **`send_interrupt = true`**: gửi Ctrl+C (SIGINT) cho bản cũ, để nó **tắt êm** như bài 0.09,
  thay vì bị giết ngang khi đang xử lý request.
- **`exclude_dir`**: sửa worker thì api không build lại, và ngược lại.
- **`delay = 500`**: lưu 5 file liền nhau thì chỉ build một lần.

### Bước 4: `backend/.dockerignore`

Những thứ không gửi vào Docker khi build image. Quan trọng nhất là `.env`: không để mật khẩu
lọt vào image.

```text
tmp/
bin/
.air*.toml
.env
.git
*.log
```

### Bước 5: Bỏ healthz khỏi log

Docker gọi `/healthz` 5 giây một lần. Chạy lên bạn sẽ thấy log toàn dòng `path=/healthz`.
Trong `requestLogger` (bài 0.07) đã có đoạn bỏ qua `/healthz` khi thành công:

```go
// Docker gọi /healthz 5 giây một lần; ghi log hết thì log toàn dòng healthz.
if r.URL.Path == "/healthz" && status < 500 {
	return
}
```

## Kiểm tra

```bash
cp backend/.env.example backend/.env
docker compose up -d --build --wait
docker compose ps
```

Cả 5 container `running`, api và hạ tầng `(healthy)`. Lần đầu mất 1–2 phút (tải image, build).

```bash
curl -s localhost:8080/healthz        # {"data":{"status":"ok"}}
curl -s localhost:8080/readyz         # {"data":{"postgres":"ok","rabbitmq":"ok","redis":"ok"}}
curl -s localhost:8080/api/v1/ping    # {"data":{"message":"pong"}}
curl -s localhost:8080/khong-co       # {"error":{"code":"route_not_found",...,"request_id":"..."}}
docker compose logs worker | tail -3  # msg="worker đang chạy"
ls -l backend/tmp                     # api, worker thuộc user của bạn, không phải root
```

**Hot reload**: sửa `"pong"` trong `server.go` thành `"pong!"`, lưu, chờ vài giây:

```bash
curl -s localhost:8080/api/v1/ping            # {"data":{"message":"pong!"}}
docker compose logs api | grep -E "tắt|chạy"  # đang tắt api… → api đã tắt → api đang chạy
```

Thấy `đang tắt api…` rồi `api đã tắt`: air gửi Ctrl+C và api tắt êm. Sửa lại như cũ.

**Thử phá**:

```bash
docker compose stop redis
curl -si localhost:8080/readyz | head -1   # HTTP/1.1 503 Service Unavailable, "redis":"lỗi"
docker compose start redis
```

**IP thật** (bài 0.07): gọi từ máy vào container, `RemoteAddr` là gateway của mạng Docker
(`172.x.0.1`), không nằm trong danh sách tin cậy, nên header giả bị bỏ qua:

```bash
curl -s -H "CF-Connecting-IP: 1.2.3.4" localhost:8080/api/v1/ping
docker compose logs api | grep path=/api/v1/ping | tail -1    # ip=172.x.0.1
```

Thêm `,172.16.0.0/12` vào cuối `HTTP_TRUSTED_PROXIES` trong `backend/.env`, rồi
`docker compose restart api`, gọi lại: log ghi `ip=1.2.3.4`. Trả `.env` về như cũ.

**Image production**:

```bash
docker build --target api -t airlife-api:thu ./backend
docker images airlife-api:thu      # ~25MB
docker rmi airlife-api:thu
```

```bash
git add . && git commit -m "Dockerfile, chạy api/worker trong Docker với air"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `dial tcp 127.0.0.1:5432: connection refused` trong log api | Đang dùng `localhost` trong container. Địa chỉ phải là tên service: `postgres:5432` |
| `permission denied` khi air ghi `tmp/` | UID trong `.env` gốc khác UID thật. Xem `id -u`, sửa `UID=` rồi `docker compose up -d` |
| Không xoá được `backend/tmp` | Đã từng chạy bằng root. `sudo rm -rf backend/tmp` một lần, sau đó không bị nữa |
| Sửa code mà air không build lại | Docker Desktop đôi khi không chuyển sự kiện thay đổi file vào container. Thêm `poll = true` vào mục `[build]` của file `.air.*.toml` |
| Sửa `backend/.env` mà không ăn | Phải khởi động lại: `docker compose restart api worker`. Air không theo dõi file `.env` |
| `port is already allocated` ở cổng 8080 | Một tiến trình khác đang dùng 8080. Đổi `API_PORT` trong `.env` gốc |
