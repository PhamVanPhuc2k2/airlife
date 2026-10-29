# Bài 0.03: Module Go và cấu trúc thư mục `backend/`

> [← Bài trước](02-ha-tang-docker-compose.md) · [Mục lục](../README.md) · [Bài sau →](04-cau-hinh-viper.md)

## Mục tiêu

Có `backend/go.mod` cố định Go 1.27.3 và khung thư mục backend. Bạn biết file nào đặt ở đâu
và **gói nào được import gói nào**.

## Bạn sẽ học

- Một module Go, hai chương trình: `cmd/api` và `cmd/worker` dùng chung code nghiệp vụ.
- `internal/` và `pkg/` khác nhau thế nào, và Go **cưỡng chế** quy tắc của `internal/` ra sao.
- Dòng `toolchain` trong `go.mod` để mọi máy build bằng đúng bản Go đã vá lỗi bảo mật.

## Viết code

### Bước 1: Cấu trúc thư mục

```
backend/
├── cmd/
│   ├── api/main.go        # khởi động HTTP server
│   └── worker/main.go     # khởi động consumer RabbitMQ
├── internal/              # code riêng của Airlife
│   ├── config/            # đọc cấu hình (viper)
│   ├── server/            # router, middleware, health check
│   └── <module>/          # auth, media, product… (các phần sau)
├── migrations/            # file SQL của golang-migrate
├── pkg/                   # thư viện dùng chung, không biết gì về nghiệp vụ Airlife
│   ├── logger/  apperr/  response/
│   └── database/  cache/  queue/
├── tmp/                   # air ghi file build vào đây (không commit)
├── .air.api.toml  .air.worker.toml  .golangci.yml  .dockerignore  .env.example
└── go.mod  go.sum
```

```bash
cd backend
mkdir -p cmd/api cmd/worker internal/config internal/server migrations \
         pkg/logger pkg/apperr pkg/response pkg/database pkg/cache pkg/queue
```

**`internal/`**: Go không cho module **khác** import gói nằm trong `internal/`. Trình biên dịch
báo lỗi `use of internal package not allowed`. Code nghiệp vụ để ở đây là an toàn, đổi thoải mái.

**`pkg/`**: code không phụ thuộc nghiệp vụ, mang sang dự án khác vẫn dùng được (logger, định dạng
phản hồi JSON, kết nối DB…).

**Quy tắc phụ thuộc** (Go không tự cưỡng chế, phải tự giữ):

```
cmd  →  internal  →  pkg
```

- `pkg` **không** import `internal`. Nếu `pkg/response` cần biết "media" là gì thì nó không còn là thư viện chung nữa.
- Module trong `internal` không gọi thẳng repository của module khác; muốn dùng dữ liệu của
  module khác thì gọi qua service của module đó.

### Bước 2: `go mod init`

```bash
cd backend
go mod init github.com/<tài-khoản>/airlife/backend
go mod edit -go=1.27 -toolchain=go1.27.3
cat go.mod
```

Đường dẫn module là tiền tố của mọi câu import trong dự án, ví dụ
`github.com/<tài-khoản>/airlife/backend/pkg/logger`. Đặt theo đường dẫn repo GitHub thật.

Kết quả:

```text
module github.com/<tài-khoản>/airlife/backend

go 1.27

toolchain go1.27.3
```

- `go 1.27`: code dùng tính năng của Go 1.27.
- `toolchain go1.27.3`: build bằng **đúng** Go 1.27.3. Máy nào có Go cũ hơn, lệnh `go` tự tải
  1.27.3 về dùng. Go 1.27.3 vá lỗi `crypto/x509`; 1.27.2 vá `net/http`, `crypto/tls`, `html/template`.
  Có bản vá mới thì sửa dòng này, commit lại.

**Không cài thư viện trước.** Mỗi thư viện được `go get` ở bài đầu tiên dùng nó.

## Kiểm tra

```bash
cd backend && go version && go env GOTOOLCHAIN
```

`go version` phải ra `go1.27.3` hoặc mới hơn.

Thử quy tắc `internal/`: tạo một thư mục ngoài module rồi import gói internal, sẽ thấy lỗi
`use of internal package ... not allowed`. Không cần làm, chỉ cần nhớ là Go chặn việc này.

```bash
git add . && git commit -m "Module Go cho backend"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `go: go.mod requires go >= 1.27` | Go trên máy cũ và `GOTOOLCHAIN=local` đang tắt việc tự tải. Chạy `go env -w GOTOOLCHAIN=auto` hoặc cài Go mới |
| Import báo `package ... is not in std` | Đường dẫn import không khớp dòng `module` trong `go.mod` |
