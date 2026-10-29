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
