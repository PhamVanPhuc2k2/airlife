# Bài 1.02: Khung Next.js chạy trong Docker

> [← Bài trước](01-logo-va-favicon.md) · [Mục lục](../README.md) · [Bài sau →](03-theme-tailwind-va-font.md)

## Mục tiêu

`make up` chạy thêm container `frontend`: Next.js 16 ở http://localhost:3000, sửa file là trang
tự cập nhật. `make fe-lint`, `make fe-typecheck`, `make fe-audit` chạy được.

## Bạn sẽ học

- Dựng Next.js **bằng tay** từ `package.json`, không dùng `create-next-app`: biết từng file để làm gì.
- Cài gói npm **trong container** Node 24, ghi phiên bản chính xác (`--save-exact`).
- Vì sao `NEXT_PUBLIC_API_URL` là `localhost` chứ không phải tên service `api`.
- Một bẫy IPv6 trong healthcheck của alpine.

## Viết code

### Vì sao không dùng `create-next-app`

`create-next-app` của Next 16 cài sẵn Tailwind **v4**, ESLint, TypeScript với phiên bản nó chọn.
Dự án cần Tailwind **3.4.17** và muốn biết rõ từng file. Tự viết thì chỉ có đúng những gì cần.

### Bước 1: Dockerfile cho frontend

#### `frontend/Dockerfile`

```dockerfile
# Một Dockerfile, nhiều target:
#   dev     → next dev (hot reload), code mount từ máy vào (docker-compose.yml)
#   runner  → image production chạy bản build standalone
#
# Build production: docker build --target runner -t airlife-frontend ./frontend

# ---------- base ----------
FROM node:24.22.1-alpine3.23 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- dev ----------
FROM base AS dev
# Code và node_modules nằm trong thư mục mount từ máy; lúc khởi động chạy npm install
# để cài gói mới mà người khác vừa thêm vào package.json (đã đủ thì xong ngay).
CMD ["sh", "-c", "npm install --no-audit --no-fund && npm run dev"]

# ---------- deps: cài đúng theo package-lock.json ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner: image production ----------
FROM node:24.22.1-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
# output: "standalone" (next.config.ts) gói server + đúng những thư viện cần dùng;
# thư mục static và public phải chép thêm.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

- **`dev`**: không `COPY` code; code mount từ máy vào. Lúc khởi động chạy `npm install` để
  nhận gói mới người khác vừa thêm (đã đủ thì xong trong 1–2 giây), rồi `npm run dev`.
- **`deps` → `build` → `runner`**: giống backend, `COPY package*.json` rồi `npm ci` trước, sau đó
  mới `COPY . .`, để sửa code không phải cài lại gói.
- **`npm ci`** (không phải `npm install`): cài **đúng** theo `package-lock.json`, lệch là báo lỗi.
  Build production phải lặp lại được y hệt.
- **`USER node`**: image production không chạy bằng root.

#### `frontend/.dockerignore`

```text
node_modules
.next
.env
.env.*
!.env.example
*.log
```

`node_modules` của máy (hoặc của container dev) không được lọt vào image production: image tự
`npm ci` bản sạch.

### Bước 2: Thêm service `frontend` vào `docker-compose.yml`

Thêm khối `frontend:` vào `services:` (trước `migrate:`). Bản đầy đủ của file:

```yaml
# Môi trường dev: mọi thứ chạy trong Docker.
#   make up      → chạy hết (hạ tầng + api + worker + frontend)
#                  web: http://localhost:3000   api: http://localhost:8080
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

  frontend:
    build:
      context: ./frontend
      target: dev
    user: "${UID:-1000}:${GID:-1000}"
    restart: unless-stopped
    volumes:
      - ./frontend:/app
    environment:
      # Địa chỉ API mà TRÌNH DUYỆT gọi tới (nên là localhost của máy, không phải tên service)
      NEXT_PUBLIC_API_URL: http://localhost:${API_PORT:-8080}
      NEXT_PUBLIC_SITE_URL: http://localhost:${FRONTEND_PORT:-3000}
      npm_config_cache: /tmp/.npm # user theo UID có thể không có thư mục home
      npm_config_update_notifier: "false" # tắt thông báo "npm có bản mới" làm rối log
    ports:
      - "127.0.0.1:${FRONTEND_PORT:-3000}:3000"
    healthcheck:
      # 127.0.0.1, không dùng localhost: trong alpine localhost ra IPv6 (::1) trước,
      # mà next dev chỉ nghe IPv4 (0.0.0.0) → healthcheck báo lỗi dù trang vẫn chạy.
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/"]
      interval: 5s
      timeout: 5s
      retries: 60 # lần đầu npm install + biên dịch trang đầu tiên khá lâu
      start_period: 15s

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

Điểm chính của khối `frontend`:

- **`NEXT_PUBLIC_API_URL: http://localhost:8080`**: biến `NEXT_PUBLIC_*` được nhúng vào JavaScript
  chạy trên **trình duyệt**. Trình duyệt nằm trên máy bạn, nó không biết tên service `api` trong
  mạng Docker là gì. Nên địa chỉ phải là `localhost:8080` (cổng api mở ra máy).
- **`npm_config_cache: /tmp/.npm`**: container chạy bằng UID của bạn; nếu UID đó không có thư
  mục home trong image, npm không ghi được cache và báo lỗi quyền.
- **Healthcheck dùng `127.0.0.1`, không dùng `localhost`**: lỗi có thật lúc làm bài này.
  `next dev` chỉ nghe IPv4 (`0.0.0.0`), còn trong alpine `localhost` được phân giải ra IPv6
  (`::1`) trước. Kết quả: trang vẫn mở được từ máy, nhưng healthcheck báo `unhealthy` và
  `make up` treo 5 phút rồi báo lỗi. Thử trong container:

  ```bash
  docker compose exec frontend wget -qO- http://localhost:3000/ >/dev/null; echo $?   # 1
  docker compose exec frontend wget -qO- http://127.0.0.1:3000/ >/dev/null; echo $?   # 0
  ```

Thêm vào `.env.example` ở gốc repo:

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
FRONTEND_PORT=3000
```

### Bước 3: `package.json` và cài gói

Viết bản khởi đầu bằng tay, chỉ có tên và các lệnh:

```json
{
  "name": "airlife-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.22.1"
  },
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0 --port 3000",
    "build": "next build",
    "start": "next start --hostname 0.0.0.0 --port 3000",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  }
}
```

- **`--hostname 0.0.0.0`**: mặc định Next chỉ nghe `localhost` **của container**; từ máy bạn
  gọi vào sẽ không tới. `0.0.0.0` là nghe mọi địa chỉ.
- **`engines`** + file `frontend/.nvmrc` (một dòng `24.22.1`): ghi rõ dự án cần Node 24.22.1 trở
  lên (bản đã vá lỗi Brotli RCE tháng 10/2026, xem TASKS.md mục 1.4).

```bash
echo "24.22.1" > frontend/.nvmrc
```

Cài gói **trong container** (Node trên máy có thể là bản khác):

```bash
make npm c="install --save-exact next@16.4.3 react@19.3.1 react-dom@19.3.1"
make npm c="install --save-exact --save-dev typescript@5.9.3 @types/node@24.19.2 @types/react@19.3.0 @types/react-dom@19.3.0 tailwindcss@3.4.17 postcss@8.5.32 autoprefixer@10.6.2 eslint@9.39.5 eslint-config-next@16.4.3 prettier@3.9.10 prettier-plugin-tailwindcss@0.8.1"
```

(`make npm` có ở bước 6; trước đó dùng thẳng `docker compose run --rm --no-deps frontend npm install ...`.)

| Gói | Vì sao |
|---|---|
| `next@16.4.3` | Bản vá ngày 14/10/2026 (2 lỗi RCE). Kéo theo `sharp@0.35.5` đã vá |
| `react@19.3.1` | React mới nhất, Next 16 hỗ trợ React 19 |
| `typescript@5.9.3` | TypeScript 7 đã ra nhưng template Next 16 vẫn dùng 5; chọn bản ổn định |
| `tailwindcss@3.4.17` | Theo yêu cầu dự án (v3, không phải v4) |
| `eslint@9`, `eslint-config-next` | Luật lint của Next: ảnh, link, hooks, Core Web Vitals |
| `prettier-plugin-tailwindcss` | Tự sắp xếp class Tailwind theo thứ tự chuẩn |

**`--save-exact`** ghi `"next": "16.4.3"` thay vì `"^16.4.3"`. Dấu `^` cho phép tự lên 16.5, 16.6
khi cài lại; dự án muốn **chủ động** nâng phiên bản (đọc changelog, kiểm tra) chứ không để tự trôi.

Kết quả `package.json` (bản **hiện tại** của repo: `zustand`, `@radix-ui/react-dialog` và `allowScripts`
thuộc bài 1.05, 1.06; ở bài này file của bạn chưa có các dòng đó):

```json
{
  "name": "airlife-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.22.1"
  },
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0 --port 3000",
    "build": "next build",
    "start": "next start --hostname 0.0.0.0 --port 3000",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@radix-ui/react-dialog": "1.3.1",
    "next": "16.4.3",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zustand": "5.0.16"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "autoprefixer": "10.6.2",
    "eslint": "9.39.5",
    "eslint-config-next": "16.4.3",
    "postcss": "8.5.32",
    "prettier": "3.9.10",
    "prettier-plugin-tailwindcss": "0.8.1",
    "tailwindcss": "3.4.17",
    "typescript": "5.9.3"
  },
  "allowScripts": {
    "unrs-resolver": false
  }
}
```

`package-lock.json` do npm sinh ra, **commit** nó, không sửa tay.

### Bước 4: Cấu hình TypeScript, Next, PostCSS

#### `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- **`strict: true`**: bật mọi kiểm tra chặt của TypeScript.
- **`noUncheckedIndexedAccess`**: `arr[0]` có kiểu `T | undefined`, bắt phải xử lý trường hợp
  mảng rỗng. Hay bắt được lỗi thật.
- **`paths: {"@/*": ["./src/*"]}`**: import `@/components/Header` thay vì `../../../components/Header`.

#### `frontend/next.config.ts`

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gói gọn server + thư viện cần thiết vào .next/standalone để image production nhỏ.
  output: "standalone",
  // Không gửi header "X-Powered-By: Next.js": không cần cho kẻ tấn công biết dùng gì.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Thumbnail video YouTube
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
};

export default nextConfig;
```

#### `frontend/postcss.config.mjs`

```js
// Tailwind 3 chạy như một plugin PostCSS. autoprefixer thêm tiền tố -webkit- … cho trình duyệt cũ.
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
```

Gán vào biến `config` rồi mới `export default`: ESLint của Next cảnh báo
`import/no-anonymous-default-export` nếu export thẳng một object vô danh.

### Bước 5: ESLint và Prettier

#### `frontend/eslint.config.mjs`

ESLint 9 dùng "flat config" (một mảng cấu hình), không còn `.eslintrc`.

```js
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);
```

#### `frontend/.prettierrc.json` và `.prettierignore`

```json
{
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindConfig": "./tailwind.config.ts"
}
```

```text
.next
node_modules
package-lock.json
public/brand
```

`tailwindConfig` cần cho Tailwind **v3**: plugin đọc file config để biết class tự định nghĩa
(`bg-brand-600`) và sắp xếp đúng.

### Bước 6: Makefile

Thêm biến `FRONTEND_RUN` và các lệnh `npm`, `fe-*`. Bản đầy đủ:

```makefile
# Lệnh tắt cho dev. Mọi thứ chạy trong Docker, máy chỉ cần Docker + make.
# Chạy từ gốc repo: make <lệnh>. Xem danh sách: make help

COMPOSE      := docker compose
# Chạy lệnh npm trong container frontend mới.
FRONTEND_RUN := $(COMPOSE) run --rm --no-deps frontend
# Chạy một lệnh trong container api mới (không cần api đang chạy, không kéo theo DB).
BACKEND_RUN  := $(COMPOSE) run --rm --no-deps api
GOLANGCI     := go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
GOVULNCHECK  := go run golang.org/x/vuln/cmd/govulncheck@v1.9.0

.PHONY: help up down restart logs ps psql migrate migrate-down migrate-new lint fmt vuln tidy \
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
```

### Bước 7: Trang đầu tiên

Tạm thời, `src/app/layout.tsx` tối thiểu và một trang chữ. Bài 1.03 sẽ viết lại cả hai.

```tsx
// src/app/layout.tsx (tạm)
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx (tạm)
export default function HomePage() {
  return <h1>Airlife</h1>;
}
```

## Kiểm tra

```bash
make up
make ps                 # frontend (healthy)
curl -s localhost:3000/ | grep -o '<title>[^<]*</title>\|rel="icon"[^>]*'
```

Mở http://localhost:3000: thấy chữ "Airlife". Sửa `page.tsx` thành `<h1>Xin chào</h1>`, lưu:
trang tự đổi, không cần tải lại.

Next.js tự sinh thẻ icon từ các file của bài 1.01: trong HTML thấy `rel="icon" href="/favicon.ico..."`,
`/icon.svg`, `apple-touch-icon`, `og:image`.

```bash
make fe-lint        # không có lỗi
make fe-typecheck   # không có lỗi
make fe-audit       # found 0 vulnerabilities
```

Image production (bài triển khai sẽ dùng):

```bash
docker build --target runner -t airlife-frontend:thu ./frontend
docker run --rm -d --name fe-thu -p 127.0.0.1:3999:3000 airlife-frontend:thu
curl -sI localhost:3999/ | head -1     # HTTP/1.1 200 OK, và KHÔNG có dòng X-Powered-By
docker stop fe-thu && docker rmi airlife-frontend:thu
```

```bash
git add . && git commit -m "Khung Next.js chạy trong Docker"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `make up` treo rồi báo `frontend is unhealthy`, nhưng trang vẫn mở được | Healthcheck dùng `localhost` (IPv6). Đổi thành `127.0.0.1` |
| Gõ `npm install` trên máy rồi container báo lỗi `sharp` / `@next/swc` | Gói có phần biên dịch sẵn theo hệ điều hành; cài trên máy (glibc) không chạy trong alpine (musl). Xoá `frontend/node_modules`, cài lại bằng `make npm c="install"` |
| `EACCES: permission denied, mkdir '/.npm'` | Thiếu `npm_config_cache: /tmp/.npm` trong compose |
| Sửa file mà trang không tự cập nhật | Docker Desktop đôi khi không chuyển sự kiện file. Thêm `WATCHPACK_POLLING: "true"` vào `environment` của frontend |
| Log đầy dòng `npm notice New major version` | Đặt `npm_config_update_notifier: "false"` (đã có trong compose) |
