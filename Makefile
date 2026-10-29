# Lệnh tắt cho dev. Mọi thứ chạy trong Docker, máy chỉ cần Docker + make.
# Chạy từ gốc repo: make <lệnh>. Xem danh sách: make help

COMPOSE      := docker compose
# Chạy lệnh npm trong container frontend mới.
FRONTEND_RUN := $(COMPOSE) run --rm --no-deps frontend
# Chạy một lệnh trong container api mới (không cần api đang chạy, không kéo theo DB).
BACKEND_RUN  := $(COMPOSE) run --rm --no-deps api
GOLANGCI     := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
GOVULNCHECK  := go run golang.org/x/vuln/cmd/govulncheck@v1.9.0

.PHONY: help up down restart logs ps psql migrate migrate-down migrate-new sqlc seed lint fmt vuln tidy \
        npm fe-lint fe-typecheck fe-format fe-audit

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

sqlc: ## Sinh code Go từ backend/internal/db/queries/*.sql
	$(COMPOSE) run --rm sqlc generate

seed: ## Nạp dữ liệu mẫu (chỉ môi trường dev)
	$(COMPOSE) run --rm api go run ./cmd/seed

lint: ## golangci-lint v2 cho backend
	$(BACKEND_RUN) $(GOLANGCI) run ./...

fmt: ## Tự định dạng code Go (gofumpt, goimports)
	$(BACKEND_RUN) $(GOLANGCI) fmt ./...

vuln: ## Quét lỗ hổng bảo mật trong code Go và thư viện
	$(BACKEND_RUN) $(GOVULNCHECK) ./...

tidy: ## go mod tidy (sau khi thêm/bớt import)
	$(BACKEND_RUN) go mod tidy

npm: ## Chạy lệnh npm cho frontend: make npm c="install --save-exact zustand@5.0.16"
	$(FRONTEND_RUN) npm $(c)

fe-lint: ## ESLint cho frontend
	$(FRONTEND_RUN) npm run lint

fe-typecheck: ## Kiểm tra kiểu TypeScript cho frontend
	$(FRONTEND_RUN) npm run typecheck

fe-format: ## Prettier: định dạng code frontend (sắp xếp class Tailwind)
	$(FRONTEND_RUN) npm run format

fe-audit: ## Quét lỗ hổng các gói npm (mức high trở lên)
	$(FRONTEND_RUN) npm audit --audit-level=high
