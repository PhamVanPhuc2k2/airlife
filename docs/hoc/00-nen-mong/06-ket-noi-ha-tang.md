# Bài 0.06: Kết nối PostgreSQL, Redis, RabbitMQ

> [← Bài trước](05-log-loi-phan-hoi.md) · [Mục lục](../README.md) · [Bài sau →](07-middleware.md)

## Mục tiêu

Ba hàm mở kết nối: `database.NewPostgres`, `cache.NewRedis`, `queue.NewRabbitMQ`. Mỗi hàm
**kiểm tra kết nối thật** trước khi trả về, để sai mật khẩu thì biết ngay lúc khởi động.

## Bạn sẽ học

- **Pool kết nối**: cả ứng dụng dùng chung một pool, không mở kết nối mới cho mỗi request.
- Nhiều thư viện "mở kết nối" mà chưa kết nối thật (lazy). Phải `Ping` để biết có thông không.
- **Không đưa URL kết nối vào thông báo lỗi**: URL chứa mật khẩu, mà lỗi thì được in ra log.

## Viết code

### Bước 1: Cài thư viện

```bash
cd backend
go get github.com/jackc/pgx/v5@v5.11.0
go get github.com/redis/go-redis/v9@v9.23.0
go get github.com/rabbitmq/amqp091-go@v1.16.0
```

| Thư viện | Vì sao chọn |
|---|---|
| `pgx/v5` | Driver PostgreSQL nhanh nhất cho Go, hỗ trợ đủ kiểu của PostgreSQL (jsonb, mảng, uuid). `sqlc` ở các phần sau sinh code cho pgx |
| `go-redis/v9` | Client Redis chính thức, do đội Redis duy trì |
| `amqp091-go` | Client RabbitMQ chính thức, do đội RabbitMQ duy trì |

### Bước 2: `pkg/database/postgres.go`

```go
// Package database mở pool kết nối PostgreSQL bằng pgx.
//
// pgxpool giữ sẵn nhiều kết nối và cho mượn theo từng truy vấn, an toàn khi nhiều
// goroutine (nhiều request) dùng cùng lúc. Cả ứng dụng chỉ tạo MỘT pool.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPostgres(ctx context.Context, url string, maxConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		// Không bọc url vào lỗi: url chứa mật khẩu, lỗi này sẽ được in ra log.
		return nil, fmt.Errorf("POSTGRES_URL sai định dạng: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("tạo pool postgres: %w", err)
	}

	// NewWithConfig không kết nối thật cho tới truy vấn đầu tiên. Ping ngay để
	// sai mật khẩu / DB chưa chạy thì báo lỗi lúc khởi động.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}
```

- **`MaxConns`**: số kết nối tối đa của pool. PostgreSQL mặc định chỉ nhận 100 kết nối cho cả
  server; api và worker mỗi bên 10 là vừa, còn chỗ cho công cụ quản trị.
- **`MaxConnIdleTime`**: kết nối rảnh quá 5 phút thì đóng, trả tài nguyên cho DB.
- **`context.WithTimeout(ctx, 5*time.Second)`**: DB không trả lời thì 5 giây sau báo lỗi, không treo mãi.
- `pool.Close()` trước khi trả lỗi: đã tạo pool mà ping lỗi thì phải dọn, không để rò.

### Bước 3: `pkg/cache/redis.go`

```go
// Package cache mở kết nối Redis bằng go-redis.
//
// Redis dùng cho: cache API, đếm lượt xem, phiên đăng nhập, rate limit, lock giữ chỗ.
// redis.Client cũng là một pool kết nối, an toàn khi dùng chung giữa các goroutine.
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func NewRedis(ctx context.Context, addr, password string, db int) (*redis.Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("ping redis %s: %w", addr, err)
	}
	return rdb, nil
}
```

Ở đây in `addr` (`localhost:6379`) vào lỗi được, vì địa chỉ không chứa mật khẩu.

### Bước 4: `pkg/queue/rabbitmq.go`

```go
// Package queue kết nối RabbitMQ bằng amqp091-go (thư viện chính thức của RabbitMQ).
//
// Bản khởi đầu chỉ mở kết nối. Publisher, consumer, retry và dead-letter queue
// được thêm ở phần gửi email (job đầu tiên của worker).
package queue

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

func NewRabbitMQ(url string) (*amqp.Connection, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		// Không in url: chứa user/mật khẩu.
		return nil, fmt.Errorf("kết nối rabbitmq: %w", err)
	}
	return conn, nil
}
```

`amqp.Dial` kết nối thật ngay (khác pgx), nên không cần ping. Bản này còn đơn giản; publisher,
consumer, retry và dead-letter queue sẽ thêm khi viết job gửi email.

## Kiểm tra

```bash
cd backend && go mod tidy && go build ./... && go vet ./...
```

Chạy thật trong Docker ở bài 0.10.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `failed to connect ... connection refused` | Hạ tầng chưa chạy (`docker compose up -d --wait`), hoặc dùng `localhost` bên trong container (phải là tên service, bài 0.10) |
| `password authentication failed` | Mật khẩu trong `POSTGRES_URL` khác `POSTGRES_PASSWORD` lúc **tạo** volume (xem bài 0.02) |
| `NOAUTH Authentication required` (Redis) | Thiếu `REDIS_PASSWORD` trong `.env` |
| `too many connections` | Tạo pool mới trong mỗi request. Pool chỉ tạo **một lần** ở `main` |
