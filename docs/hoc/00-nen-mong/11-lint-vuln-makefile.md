# Bài 0.11: golangci-lint, govulncheck, Makefile

> [← Bài trước](10-docker-va-air.md) · [Mục lục](../README.md) · [Bài sau →](12-migration-dau-tien.md)

## Mục tiêu

- `make lint` bắt lỗi mà trình biên dịch bỏ qua; `make vuln` bắt thư viện có lỗ hổng bảo mật.
- Mọi lệnh hay dùng gói gọn trong `make <lệnh>`, tất cả chạy trong Docker.

## Bạn sẽ học

- golangci-lint **v2** (định dạng cấu hình khác v1), và cách tắt linter đúng chỗ, có lý do.
- Chạy công cụ trong container bằng `docker compose run --rm`.
- Lỗ hổng có thể nằm ở **thư viện gián tiếp** mà bạn không hề `go get`.

## Viết code

### Bước 1: `backend/.golangci.yml`

golangci-lint chạy nhiều linter cùng lúc. **Phải dùng v2**: v1 (đến 1.64) không đọc được code
Go 1.27. Không cần cài: Makefile chạy `go run ...golangci-lint@v2.15.0` bên trong container,
nên mọi máy dùng đúng một bản.

```yaml
# Cấu hình golangci-lint v2 (định dạng v1 không dùng được với v2).
# Chạy: cd backend && golangci-lint run ./...
version: "2"

run:
  timeout: 5m

linters:
  # standard = errcheck, govet, ineffassign, staticcheck, unused
  default: standard
  enable:
    - bodyclose      # quên đóng resp.Body khi gọi HTTP ra ngoài (YouTube, Resend…) → rò kết nối
    - errorlint      # so sánh lỗi bằng == thay vì errors.Is/As → hỏng khi lỗi bị bọc
    - gosec          # lỗi bảo mật: SQL ghép chuỗi, quyền file, random yếu…
    - misspell
    - noctx          # tạo HTTP request không có context → không huỷ được khi client ngắt
    - revive
    - rowserrcheck   # quên kiểm tra rows.Err() sau vòng lặp đọc DB
    - sqlclosecheck  # quên đóng rows
    - unconvert
  settings:
    revive:
      rules:
        - name: exported
          disabled: true # không bắt buộc comment cho mọi hàm exported

formatters:
  enable:
    - gofumpt
    - goimports
  settings:
    goimports:
      local-prefixes:
        - github.com/PhamVanPhuc2k2/airlife/backend
```

### Bước 2: Makefile

```makefile
# Lệnh tắt cho dev. Mọi thứ chạy trong Docker, máy chỉ cần Docker + make.
# Chạy từ gốc repo: make <lệnh>. Xem danh sách: make help

COMPOSE     := docker compose
# Chạy một lệnh trong container api mới (không cần api đang chạy, không kéo theo DB).
BACKEND_RUN := $(COMPOSE) run --rm --no-deps api
GOLANGCI    := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
GOVULNCHECK := go run golang.org/x/vuln/cmd/govulncheck@v1.9.0

.PHONY: help up down restart logs ps psql migrate migrate-down migrate-new lint fmt vuln tidy

help: ## Liệt kê các lệnh
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-14s %s\n", $$1, $$2}'

up: ## Build và chạy cả hệ thống, chờ tới khi healthy
	$(COMPOSE) up -d --build --wait

down: ## Tắt cả hệ thống (giữ dữ liệu trong volume)
	$(COMPOSE) down

restart: ## Khởi động lại một service: make restart s=api
	$(COMPOSE) restart $(s)

logs: ## Xem log, mặc định tất cả; một service: make logs s=api
	$(COMPOSE) logs -f --tail=100 $(s)

ps: ## Trạng thái các container
	$(COMPOSE) ps

psql: ## Mở psql vào database dev
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

migrate: ## Chạy mọi migration chưa chạy
	$(COMPOSE) run --rm migrate up

migrate-down: ## Lùi 1 migration
	$(COMPOSE) run --rm migrate down 1

migrate-new: ## Tạo cặp file migration mới: make migrate-new name=create_users
	@test -n "$(name)" || (echo "Thiếu tên: make migrate-new name=create_users" && exit 1)
	$(COMPOSE) run --rm --no-deps migrate create -ext sql -dir /migrations -seq -digits 6 $(name)

lint: ## golangci-lint v2 cho backend
	$(BACKEND_RUN) $(GOLANGCI) run ./...

fmt: ## Tự định dạng code Go (gofumpt, goimports)
	$(BACKEND_RUN) $(GOLANGCI) fmt ./...

vuln: ## Quét lỗ hổng bảo mật trong code Go và thư viện
	$(BACKEND_RUN) $(GOVULNCHECK) ./...

tidy: ## go mod tidy (sau khi thêm/bớt import)
	$(BACKEND_RUN) go mod tidy
```

- **`$(COMPOSE) run --rm --no-deps api <lệnh>`**: tạo một container api **mới** chỉ để chạy lệnh
  rồi xoá (`--rm`), không khởi động kéo theo DB (`--no-deps`). Lint không cần DB.
- **`## mô tả`** sau tên lệnh: `make help` đọc các dòng này để in danh sách lệnh.
- **`$$POSTGRES_USER`** trong `psql`: `$$` để make truyền nguyên `$` cho shell **trong container**.
- **`.PHONY`**: báo cho make biết `lint`, `up`… là tên lệnh, không phải tên file.
- Dòng lệnh trong Makefile **phải** bắt đầu bằng tab (bài 0.01, `.editorconfig`).

### Bước 3: Lần lint đầu tiên: câu chuyện có thật của dự án này

Lần đầu chạy lint trên code của các bài trước, nó bắt được 6 lỗi:

- 4 lỗi `errcheck`: `defer rdb.Close()` bỏ qua lỗi trả về. Sửa thành `defer func() { _ = rdb.Close() }()`,
  tức là **chủ động** bỏ qua (bài 0.09 đã gõ bản sửa).
- 1 lỗi `errorlint`: `rec == http.ErrAbortHandler`. Ở đây so sánh bằng `==` là đúng (bài 0.07),
  nên tắt riêng dòng đó bằng `//nolint:errorlint // lý do`. **Luôn ghi lý do khi tắt linter.**
- 1 lỗi `gofumpt`: định dạng. Sửa tự động bằng `make fmt`.

### Bước 4: Quét lỗ hổng

Lần đầu chạy `make vuln`, govulncheck báo:

```text
Vulnerability #1: GO-2026-6629
  Module: golang.org/x/text
    Found in: golang.org/x/text@v0.29.0
    Fixed in: golang.org/x/text@v0.41.0
Vulnerability #2: GO-2026-5970
    Fixed in: golang.org/x/text@v0.39.0
  ... database.NewPostgres calls pgxpool.NewWithConfig, which eventually calls norm.Form.Transform
```

Dự án **không hề** `go get golang.org/x/text`. Nó là thư viện **gián tiếp**: pgx cần nó, và
`go get` kéo về bản cũ mà pgx khai báo. govulncheck còn chỉ ra đường gọi cụ thể, nên biết lỗi
này **thật sự** ảnh hưởng tới code của mình chứ không chỉ nằm trong `go.sum`.

Cách vá: nâng thẳng thư viện gián tiếp lên bản mới.

```bash
docker compose run --rm --no-deps api go get golang.org/x/text@v0.43.0 golang.org/x/sys@v0.49.0 golang.org/x/sync@v0.24.0
make tidy
make vuln     # No vulnerabilities found.
```

Bài học: **chạy `make vuln` sau mỗi lần thêm thư viện**, và trong CI (giai đoạn triển khai)
để build fail khi có lỗ hổng mới.

## Kiểm tra

```bash
make help
make lint      # 0 issues.
make vuln      # No vulnerabilities found.
make down && make up
make logs s=api      # Ctrl+C để thoát xem log
make psql            # \q để thoát
```

Lần đầu `make lint` mất 1–2 phút (tải và build golangci-lint); các lần sau nhanh nhờ volume `go-cache`.

```bash
git add . && git commit -m "Lint, vuln, Makefile"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `Makefile:…: *** missing separator` | Dòng lệnh dùng dấu cách thay vì tab |
| golangci-lint báo `unsupported version of the configuration` | Đang chạy v1 với file cấu hình v2. Dùng `make lint` (đã ghim v2.15.0) |
| `the Go language version (go1.26) used to build golangci-lint is lower than the targeted Go version (1.27)` | Chạy golangci-lint cài sẵn trên máy (quá cũ). Dùng `make lint` |
| `failed to get cache dir` / `permission denied` ở `.cache` | Image dev thiếu `XDG_CACHE_HOME=/go/cache` (bài 0.10). Build lại: `make up` |
