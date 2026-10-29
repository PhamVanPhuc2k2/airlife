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
