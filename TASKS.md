# AIRLIFE: Danh sách task dự án

> Đập đi xây lại hoàn toàn skyline.vn thành **Airlife** ("Đời sống hàng không").
> Giao diện gốc: mockup tĩnh ở `../skyline` (14 trang HTML + SCSS + `data/content.json`).
> Nội dung giữ lại từ site cũ skyline.vn: **Line-up phim theo tháng**, **Tin tức**, **song ngữ VI/EN**, thông tin liên hệ, link mạng xã hội.

---

## 0. Tóm tắt kiến trúc

| Lớp | Công nghệ |
|---|---|
| Frontend | Node.js **24 LTS**, Next.js **16** (App Router, TypeScript), React **19.2**, Tailwind CSS **v3.4.17**, Zustand (state client), TanStack Query (state server), Radix UI (component không style), Tiptap (editor CMS) |
| Backend | Go **1.27** (REST API, router **go-chi**), PostgreSQL (dữ liệu chính), Redis (cache, session, rate limit, counter), RabbitMQ (job bất đồng bộ) |
| Hạ tầng | Docker Compose (dev), **Cloudflare** (DNS + proxy, SSL, chống DDoS, WAF) → Nginx reverse proxy, lưu ảnh và file upload (avatar, sản phẩm, tin tức, kênh…) trên **Cloudflare R2** |
| Email | **Resend** |
| Chống spam | **Cloudflare Turnstile** cho các form công khai |
| Video & âm thanh | Nhúng từ **YouTube** cho cả mục Xem lẫn Nghe (không tự host, server không chịu tải video) |

> Phiên bản cụ thể và quy định cập nhật bản vá: xem mục **1.4**.

```
airlife/
├── frontend/     # Next.js
├── backend/      # Go: 1 module, 2 binary (api + worker), cấu trúc ở mục 2.0
├── docker-compose.yml  # dev: cả hệ thống chạy trong Docker (make up)
├── deploy/       # (giai đoạn triển khai) nginx, compose production
└── docs/
```

### Bộ nhận diện Airlife (từ `~/Downloads/Brand Airlife.pdf`)

| Mục | Giá trị |
|---|---|
| Màu chính (Màu 1) | `#6C3C8B` (tím) |
| Màu 2 (dải màu) | gradient `#C86E3A` → `#F8AC3F` (cam đồng → vàng cam), điểm dừng 50% |
| Font logo | FS Magistral Bold (chữ logo cách điệu) |
| Font slogan | FS Magistral Medium |
| Slogan | "Đời sống hàng không" |

---

## Giai đoạn 1: Chuẩn bị & thiết kế hệ thống

### 1.1 Brand & tài sản
- [x] Xuất logo từ `Brand Airlife.pdf` ra SVG (tách lệnh vẽ vector trong PDF): `frontend/public/brand/` có logo đầy đủ, wordmark (không slogan), biểu tượng; mỗi loại có bản nền tối. Ảnh Open Graph 1200×630
- [x] Favicon `favicon.ico` (16/32/48), `icon.svg`, `apple-icon.png` 180×180 trong `frontend/src/app/` (Next.js tự nhận)
- [x] Font web: **Be Vietnam Pro** (chốt, chưa có bản quyền FS Magistral cho web). Logo vẫn đúng font gốc vì chữ trong logo đã là nét vẽ
- [ ] Đổi toàn bộ bảng màu mockup (xanh sky/indigo + cam san hô) sang bảng màu Airlife: tím `#6C3C8B` làm primary, gradient cam làm accent (giá, CTA mua hàng, thanh Player)
- [ ] Sinh thang màu `brand-50…900` từ `#6C3C8B` và `accent-50…900` từ `#F8AC3F`, kiểm tra tương phản WCAG AA cho chữ trên nền
- [ ] Thay mọi chữ "SKYLINE"/"Skyline Media"/`skyline.vn` trong nội dung mẫu thành Airlife

### 1.2 Phân tích mockup → đặc tả
- [ ] Liệt kê component từ `skyline/scss/_components.scss`, `_layout.scss`, `_home.scss`, `_pages.scss` (card media, card sản phẩm, chip filter, avatar, rating, comment, player…)
- [ ] Chuyển icon Player (`skyline/js/icons.js`, `images/icons/*.svg`) và icon nét (`ICON_PATHS` trong `layout.js`) thành React component
- [ ] Viết sitemap & route map (xem mục 3)
- [ ] Viết ERD từ `data/content.json` (xem mục 2.2)
- [ ] Viết đặc tả API (OpenAPI 3) trước khi code

### 1.3 Khởi tạo repo
- [x] `git init`, cấu trúc monorepo, `.editorconfig`, `.gitattributes`, `.gitignore`, remote GitHub
- [x] `docker-compose.yml` ở gốc repo: **mọi thứ chạy bằng Docker** (postgres 18.6, redis 8.10.3, rabbitmq 4.4.0, api + worker chạy air, service `migrate`). Frontend thêm ở phần frontend
- [x] `backend/Dockerfile` nhiều target: `dev` (air), `api`, `worker` (distroless nonroot, ~25MB)
- [x] Makefile (mọi lệnh chạy qua Docker): `up`, `down`, `restart`, `logs`, `ps`, `psql`, `migrate`, `migrate-down`, `migrate-new`, `lint`, `fmt`, `vuln`, `tidy` (còn thiếu: `seed`, lệnh frontend)
- [ ] CI (GitHub Actions/GitLab CI): lint + build cho `frontend` và `backend`

### 1.4 Phiên bản & bản vá bảo mật (BẮT BUỘC trước khi khởi tạo)

> Tháng 10/2026 có nhiều đợt vá lỗi bảo mật nghiêm trọng (Node.js: Brotli RCE; Next.js: 2 lỗi RCE không cần đăng nhập; Go: crypto/x509, HTTP/2).
> Không dùng bản cũ chưa vá. Phiên bản dưới đây là **mức tối thiểu** tính đến 29/10/2026; kiểm tra lại trang chính thức ngay trước khi khởi tạo và dùng bản vá mới nhất nếu đã có.

| Thành phần | Phiên bản tối thiểu | Ghi chú |
|---|---|---|
| Node.js | **24.22.1** (LTS) | Bản vá 21/10/2026. Nếu nodejs.org đã gắn nhãn LTS cho 26.x thì có thể dùng **26.12.1** trở lên. Không dùng 20.x, 25.x (hết hỗ trợ, không có bản vá) |
| Go | **1.27.3** | Bản vá crypto/x509 (CVE-2026-111943) + các bản vá net/http, crypto/tls, html/template của 1.27.2 |
| Next.js | **16.4.1** | Bản vá 14/10/2026 (RCE ở Image Optimization và `use cache`, DoS ở Server Actions) |
| sharp | **0.35.5** | Next.js dùng để xử lý ảnh, ép phiên bản bằng `overrides` nếu cần; kiểm tra bằng `npm ls next sharp` |
| React / React DOM | bản vá mới nhất của **19.2.x** | Đúng phiên bản Next.js 16.4.1 yêu cầu; nhiều lỗi RSC trước đây (CVE-2025-55182…) |
| Tailwind CSS | **3.4.17** (cố định theo yêu cầu) | Chỉ chạy lúc build, không chạy trên server production |
| PostgreSQL | bản vá mới nhất của **18.x** | Không dùng 19 (mới RC); 14.x hết hỗ trợ 12/11/2026 |
| Redis, RabbitMQ | bản ổn định mới nhất | Kiểm tra trang security advisory trước khi chốt |

- [x] Cố định phiên bản: `.nvmrc` + `"engines"` trong `package.json`, `--save-exact` cho mọi gói npm; dòng `go` và `toolchain` trong `go.mod`; commit lockfile (`package-lock.json`, `go.sum`)
- [x] Docker image ghi rõ phiên bản patch (`node:24.22.1-alpine3.23`, `golang:1.27.3-alpine3.23`, `postgres:18.6-alpine`, `redis:8.10.3-alpine`, `rabbitmq:4.4.0-management-alpine`, `migrate/migrate:v4.20.1`), không dùng tag `latest`
- [ ] CI chạy `npm audit --audit-level=high` và `govulncheck ./...`; build fail nếu có lỗ hổng mức high/critical
- [ ] Bật Dependabot hoặc Renovate để tự tạo PR khi có bản vá mới
- [ ] Đăng ký theo dõi thông báo bảo mật: nodejs.org security, Next.js GitHub advisories, golang-announce, PostgreSQL security
- [ ] Quy định: bản vá mức critical/high phải cập nhật và deploy trong 48 giờ

---

## Giai đoạn 2: Backend (Go)

### 2.0 Cấu trúc thư mục `backend/` (bắt buộc tuân theo)

```
backend/
├── cmd/
│   ├── api/main.go          # khởi động HTTP server (go-chi)
│   ├── worker/main.go       # khởi động consumer RabbitMQ
│   └── seed/main.go         # nạp dữ liệu mẫu từ skyline/data/content.json
├── internal/                # code nghiệp vụ, không cho module ngoài import
│   ├── config/              # viper: đọc .env + biến môi trường → struct Config
│   ├── server/              # router chi, middleware (CORS, rate limit, Turnstile, auth, i18n)
│   ├── db/                  # code sinh từ sqlc + file queries/*.sql
│   ├── auth/                # mỗi module gồm handler.go, service.go, repository.go, dto.go
│   ├── media/  product/  order/  payment/  channel/  comment/  news/
│   ├── utility/  opinion/  me/  collection/  search/  upload/  notification/  admin/
│   └── jobs/                # handler cho từng loại job của worker (email, youtube check, flush counter…)
├── migrations/              # golang-migrate: 000001_init.up.sql / 000001_init.down.sql
├── pkg/                     # thư viện dùng chung, không phụ thuộc nghiệp vụ
│   ├── logger/  response/  pagination/  validator/
│   ├── cache/               # go-redis
│   ├── queue/               # amqp091-go: publisher, consumer, retry, DLQ
│   └── r2/  resend/  turnstile/  youtube/  sanitize/   # client bên thứ ba, bluemonday
├── tmp/                     # output build của air (gitignore)
├── .air.api.toml            # hot reload: build ./cmd/api → tmp/api
├── .air.worker.toml         # hot reload: build ./cmd/worker → tmp/worker
├── .env.example             # mẫu biến môi trường (commit); .env thật không commit
├── .dockerignore
├── .golangci.yml
├── sqlc.yaml
├── go.mod
└── go.sum
```

- [x] Tạo khung thư mục như trên, `go mod init`, cài `air` cho hot reload
- [x] `.air.api.toml` / `.air.worker.toml`: theo dõi `cmd/`, `internal/`, `pkg/`; loại trừ `tmp/`, `migrations/`
- [x] `.dockerignore`: loại trừ `tmp/`, `.air*.toml`, `.git`, `.env`
- [x] `.golangci.yml` (golangci-lint v2.15.0): standard + `bodyclose`, `errorlint`, `gosec`, `noctx`, `revive`, `rowserrcheck`, `sqlclosecheck`; formatter `gofumpt`, `goimports`
- [x] Quy tắc phụ thuộc: `cmd` → `internal` → `pkg`; `pkg` không import `internal`; module trong `internal` không gọi thẳng repository của module khác (đi qua service)

### 2.1 Nền tảng
- [x] Stack: router `go-chi/chi/v5`, `pgx` + `sqlc` 1.31.1 (chạy bằng image Docker) cho truy vấn, `golang-migrate` cho migration, `go-redis`, `amqp091-go`
- [ ] Thư viện thêm: ✓ `bluemonday` v1.0.27 (lọc HTML, kèm nâng `golang.org/x/net` v0.62.0 vá GO-2025-3595); còn `resend-go` (gửi email)
- [x] Config bằng **viper** (`internal/config`):
  - Đọc file `.env` khi dev (`SetConfigFile(".env")`, không bắt buộc có file), biến môi trường thật ghi đè (`AutomaticEnv`)
  - Unmarshal vào struct `Config` lồng nhóm: `App`, `HTTP`, `Postgres`, `Redis`, `RabbitMQ`, `R2`, `Resend`, `Turnstile`, `YouTube`, `JWT`, `Payment`
  - Đặt giá trị mặc định bằng `SetDefault`; kiểm tra biến bắt buộc khi khởi động, thiếu thì dừng và báo rõ tên biến
  - Load một lần trong `cmd/api` và `cmd/worker`, truyền `Config` xuống qua tham số, không gọi `viper.Get*` rải rác trong code nghiệp vụ
  - Không log giá trị secret (mật khẩu DB, API key, JWT secret)
- [x] Logging có cấu trúc (`slog`), request ID
- [ ] Middleware: ✓ CORS, ✓ recover, ✓ timeout, ✓ IP thật (CF-Connecting-IP, chỉ tin proxy trong danh sách); còn: rate limit (Redis), gzip, i18n (`Accept-Language` vi/en)
- [ ] Chuẩn response lỗi (✓ `pkg/apperr` + `pkg/response`), phân trang (✓ con trỏ cho danh sách media; còn offset cho admin)
- [x] Health check `/healthz`, `/readyz` (ping DB, Redis, RabbitMQ)
- [x] Graceful shutdown

### 2.2 Database (PostgreSQL)
Bảng dựa trên `data/content.json` của mockup:
- [x] `users` (email `citext` UNIQUE, mật khẩu argon2id, vai trò, trạng thái, `email_verified_at`). Phiên/refresh token lưu Redis (không cần bảng `user_sessions`)
- [x] `channels` (loại kênh, `verified`, `followers_count`) + `channel_followers` (khoá chính ghép, Phần 05)
- [x] `categories` (xem, nghe, kinh-doanh, tour-bay) + `category_filters` (chip lọc). Tin tức có bảng riêng ở Phần 03
- [ ] `media` (✓ video/audio, `youtube_id` có CHECK 11 ký tự, `tags[]` cho chip lọc, thời lượng hoặc số tập, `view_count`, `featured`, `lineup_month`, `status`, index tìm kiếm không dấu); ✓ `media_products` (Phần 07)
- [ ] ✓ `products` (`kind` goods/booking, chuyên mục + chip lọc, giá "từ", giá cũ, rating, đã bán, cách nhận hàng) + `product_variants` (MỘT thuộc tính: nhãn, giá, tồn kho; chốt với khách 29/10/2026) (Phần 07); còn lịch khởi hành, hạng dịch vụ cho vé & tour (Phần 08)
- [ ] ✓ `cart_items` (không cần bảng `carts`: mỗi người một giỏ), `orders` (mã AL-…, idempotency key, CHECK theo cách nhận hàng), `order_items` (snapshot tên/giá) (Phần 07); còn `payments` (Phần 09)
- [x] `comments` (media **hoặc** bài viết, trả lời 1 cấp, `like_count`/`reply_count`, xoá mềm `status`) + `comment_likes` (Phần 05)
- [x] `news_categories` + `news` (Khám phá, Sự kiện, Mẹo bay, Line-up phim, Kinh doanh; `body_html` đã lọc, `status` draft/published/hidden)
- [ ] `flights`, `airports` (cho Tiện ích: ra tàu bay, Flightradar, thời tiết điểm đến)
- [ ] `experiences` (chia sẻ trải nghiệm chuyến bay), `surveys`, `survey_options`, `survey_votes`, `feedbacks` (góp ý)
- [ ] ✓ `watch_history` (tiến độ xem, "Tiếp tục xem"), `saved_media`, `playlists` + `playlist_items` (riêng tư, tối đa 50 playlist × 200 mục) (Phần 06); ✓ `favorites` (Phần 07)
- [ ] `notifications`
- [ ] Bảng dịch cho nội dung song ngữ (cột `title_vi/title_en` hoặc bảng `*_translations`), chốt một cách
- [x] Index cho tìm kiếm: bật `pg_trgm` + `unaccent`, hàm `immutable_unaccent` (migration 000001). Index cụ thể tạo cùng bảng ở từng phần
- [x] Seed (`cmd/seed`, `make seed`) từ `skyline/data/content.json` đã đổi brand: 4 chuyên mục, 7 kênh, 21 media. Chưa có `youtube_id` thật (chờ khách gửi link)

### 2.3 Xác thực & phân quyền
- [ ] Đăng ký/đăng nhập email + mật khẩu: ✓ argon2id (OWASP m=19MiB,t=2,p=1), ✓ chặn dò mật khẩu theo email (5/15 phút) và IP (20/15 phút), ✓ không lộ email nào có tài khoản, ✓ giới hạn đăng ký 10/giờ/IP, ✓ xác minh email (token một lần, 24 giờ, bấm nút mới xác minh, gửi lại tối đa 3 thư/giờ); còn Turnstile ở form đăng ký, quên mật khẩu
- [ ] Đăng nhập Google/Facebook (OAuth2), tùy chọn OTP số điện thoại
- [x] JWT access token 15 phút (HS256, ghim thuật toán) + refresh token 30 ngày lưu Redis (chỉ lưu bản băm), xoay vòng mỗi lần dùng, phát hiện tái sử dụng → thu hồi cả phiên (có ân hạn 10s cho hai tab). Cookie `HttpOnly`, `SameSite=Lax`, refresh chỉ gửi ở `/api/v1/auth`; chống CSRF bằng kiểm tra `Origin`
- [x] Quên mật khẩu / đặt lại mật khẩu: luôn trả 204 (không lộ email), token một lần 30 phút, giới hạn 3 thư/giờ/email và 10 yêu cầu/giờ/IP, đặt lại xong đăng xuất mọi thiết bị
- [ ] Vai trò: ✓ cột `role` (`user`, `creator`, `business`, `editor`, `admin`) trong access token và `/auth/me`; còn middleware kiểm tra vai trò cho từng API (khi có API cần, vd. CMS)

### 2.4 API module
- [ ] **Home**: ✓ `GET /home` (nổi bật, 3 ô trái, hàng 4 thẻ xem nhiều, nghe nhiều; cache Redis 60s); ✓ cột bình luận nổi bật (tab Hay/Nhiều, Phần 05); ✓ khối kinh doanh (Phần 07); còn tiện ích (Phần 10)
- [x] **Categories**: danh sách, chi tiết kèm chip lọc (cache Redis 10 phút)
- [ ] **Media**: ✓ danh sách (lọc chuyên mục/chip/line-up, sắp mới/xem nhiều, phân trang con trỏ), chi tiết, gợi ý liên quan, lượt xem (Redis + worker, mỗi IP 1 lượt/30 phút); còn lưu tiến độ xem (cần đăng nhập)
- [ ] **Line-up**: phim theo tháng (giữ từ site cũ)
- [ ] **Products**: ✓ danh sách (chuyên mục, chip, kênh; mới nhất / bán chạy; phân trang con trỏ), chi tiết (biến thể, video có sản phẩm, gợi ý), sản phẩm trong video, yêu thích (Phần 07); còn lịch khởi hành cho vé & tour (Phần 08), đánh giá sản phẩm thật (hiện rating là số mẫu)
- [x] **Cart & Orders**: giỏ (khách: preview, gộp khi đăng nhập bằng GREATEST), đặt hàng COD (trừ kho có điều kiện, idempotency key, bắt xác minh email, 10 đơn/giờ), lịch sử, huỷ đơn chờ xác nhận (trả kho) (Phần 07). Chuyển trạng thái confirmed/delivering/completed ở trang quản trị (Phần 12)
- [ ] **Payment**: tích hợp cổng VNPay/MoMo/ZaloPay, webhook IPN, đối soát
- [x] **Channels**: chi tiết kênh, nội dung của kênh (`/media?channel=`), theo dõi/bỏ theo dõi (transaction, bấm 2 lần chỉ tính 1), `/me/following`
- [x] **Comments**: viết, trả lời 1 cấp, thích, xoá (chủ bình luận hoặc editor/admin), sắp xếp Hay/Mới, bình luận nổi bật. Chống spam: bắt buộc xác minh email + rate limit 10 bình luận/5 phút/người (Redis). Chưa dùng Turnstile cho bình luận: chỉ thêm nếu vẫn bị spam
- [x] **News**: chuyên mục, danh sách theo chuyên mục (phân trang con trỏ), chi tiết, bài liên quan; `/lineup/months` cho line-up phim
- [ ] **Utilities**: chuyến bay (ra tàu bay, trạng thái, tiến độ), Flightradar (proxy API bên thứ ba), thời tiết điểm đến (proxy + cache), Wi-Fi, phòng chờ & fast-track
- [ ] **Opinions**: trải nghiệm, khảo sát (bình chọn 1 lần/user), góp ý (có Turnstile)
- [ ] **Me (Bạn)**: ✓ hồ sơ, số liệu (`/me/stats`), tiếp tục xem (`/me/continue`), kênh theo dõi, trạng thái một media (`/me/media/{slug}`) (Phần 06); còn chuyến bay sắp tới (Phần 10), đơn hàng (Phần 07)
- [ ] **Collection (Sưu tập)**: ✓ playlist (tạo, đổi tên, xoá, thêm/bớt mục), đã lưu, đã xem + ghi tiến độ từ trình phát (Phần 06); còn yêu thích sản phẩm/tour (Phần 07), phát tự động hết playlist (hàng đợi phát trong player store)
- [ ] **Search**: tìm chung media/sản phẩm/kênh/tin tức, gợi ý từ khóa
- [ ] **Contact**: gửi liên hệ (có Turnstile)
- [ ] Middleware Go xác minh token Turnstile (gọi `siteverify` của Cloudflare) cho các endpoint form công khai
- [ ] Lọc HTML bằng `bluemonday` (✓ `pkg/sanitize.ArticleHTML` cho bài viết, dùng cả trong seed); còn policy cho mô tả sản phẩm/tour (Phần 07–08) và nối vào editor CMS (Phần 12)
- [ ] **Upload file**: Go tạo presigned PUT URL lên Cloudflare R2 (`aws-sdk-go-v2`, endpoint R2), client upload thẳng lên R2; giới hạn loại file và dung lượng; video & âm thanh không upload (dùng YouTube)
- [ ] Cấu hình R2: bucket dev/prod, CORS cho domain web, custom domain public (vd. `cdn.airlife.vn`), lưu key file trong DB thay vì URL đầy đủ
- [ ] Job: dọn file R2 mồ côi (upload xong nhưng không gắn vào bản ghi nào)
- [ ] **YouTube**: dán link YouTube → gọi YouTube Data API v3 lấy tiêu đề, mô tả, thời lượng, thumbnail; báo lỗi nếu video bị riêng tư hoặc chặn nhúng
- [ ] **Notifications**: danh sách, đánh dấu đã đọc

### 2.5 Redis
- [ ] Cache các endpoint đọc nhiều (✓ home, categories); còn chi tiết media/news + invalidation khi admin sửa
- [ ] Counter lượt xem (✓), lượt thích; flush về PostgreSQL theo lô (✓ lượt xem)
- [ ] Session/refresh token, blacklist token khi logout
- [ ] Rate limit theo IP/user
- [ ] Lock phân tán khi giữ chỗ vé/tour

### 2.6 RabbitMQ & worker
- [x] Hàng đợi job (`pkg/queue`): mỗi loại job có queue chính, `.retry` (chờ 30s rồi tự quay lại), `.dead` (lỗi quá 5 lần); publisher confirms; consumer ack thủ công, prefetch
- [ ] Job gửi email (`internal/mail`, queue `email.send`): ✓ mẫu xác minh email, đặt lại mật khẩu (HTML + chữ thường); ✓ dev gửi qua SMTP vào **Mailpit** (thay MailHog đã ngừng phát triển từ 2020); ✓ mẫu xác nhận đơn hàng (Phần 07); còn gửi qua Resend ở production, logo ảnh trong thư
- [ ] Job: kiểm tra định kỳ video YouTube còn hoạt động (bị xóa, chuyển riêng tư, chặn nhúng) → ẩn và báo admin
- [ ] Job: xử lý webhook thanh toán → cập nhật đơn → gửi thông báo
- [x] Job: flush counter lượt xem Redis → DB (worker, 30 giây một lần, gom lần cuối khi tắt)
- [ ] Job: gửi notification khi kênh theo dõi có nội dung mới
- [ ] Job: đồng bộ dữ liệu chuyến bay / thời tiết định kỳ

### 2.7 Admin API (CMS)
- [ ] CRUD toàn bộ nội dung: media, line-up, sản phẩm, kênh, tin tức, khảo sát, chuyến bay, sân bay
- [ ] Kiểm duyệt bình luận, trải nghiệm, góp ý
- [ ] Quản lý đơn hàng, người dùng, vai trò
- [ ] Thống kê cơ bản (lượt xem, doanh thu, đơn hàng)

### 2.8 Chất lượng backend
- [ ] Sinh tài liệu Swagger UI từ OpenAPI
- [x] `golangci-lint`

---

## Giai đoạn 3: Frontend (Next.js)

### 3.1 Khởi tạo
- [x] Dựng Next.js 16.4.3 bằng tay (không dùng `create-next-app` vì nó cài Tailwind v4): React 19.3.1, TypeScript 5.9.3, ESLint 9 + `eslint-config-next`, `tailwindcss@3.4.17`, `postcss`, `autoprefixer`. Chạy trong Docker (`frontend/Dockerfile` target `dev`/`runner`, service `frontend` ở cổng 3000)
- [x] Cài `zustand@5.0.16`, `@tanstack/react-query@5.105.0`, `@tanstack/react-query-devtools`, `@types/youtube@0.3.0`
- [ ] Cài Radix UI primitives: ✓ dialog (ngăn kéo menu); còn dropdown-menu, tabs, popover, tooltip, slider, toast, `@marsidev/react-turnstile` (cài ở bài dùng tới). Menu chuyên mục xổ bằng CSS hover/focus-within như mockup, không cần Radix
- [x] Prettier + `prettier-plugin-tailwindcss`
- [x] `tailwind.config.ts`: theme Airlife từ `skyline/scss/_variables.scss` (thang màu brand tím / accent cam 50–950 đã kiểm tra tương phản WCAG, surface, ink, overlay, runway; radius card 16/10; shadow sm/md/lg/brand; gradient brand/accent/hero/glow; screens xs 400 + mặc định; spacing header/topnav/sidebar/tabbar/player)
- [x] Font qua `next/font/google` (Be Vietnam Pro, subset vietnamese, tự host)
- [ ] i18n VI/EN (`next-intl`), route `/[locale]/...`, nút chuyển ngôn ngữ như site cũ
- [ ] API client: ✓ `lib/api.ts` (hai địa chỉ server/trình duyệt, `ApiError`), ✓ `QueryProvider`, ✓ prefetch trên server + `HydrationBoundary`; còn refresh token tự động (Phần 05)
- [ ] Biến môi trường (✓ `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `API_INTERNAL_URL`), `next.config` cho domain ảnh (✓ `i.ytimg.com`, `picsum.photos` cho dữ liệu mẫu; còn custom domain R2)

### 3.2 Store Zustand
- [x] Người đang đăng nhập: dùng TanStack Query (`useMe`, key `["auth","me"]`) thay cho `useAuthStore`, vì đây là dữ liệu server; trạng thái "chưa biết" lúc hydrate
- [ ] `usePlayerStore`: ✓ phát/dừng, tắt tiếng, tua ±10s, tiến độ thật từ YouTube, slot trang xem, controller; còn âm lượng, hàng đợi
- [x] `useGuestCart` (`stores/cart-store.ts`): giỏ của khách, `persist` + `skipHydration`; đăng nhập thì `CartSync` gộp lên server (Phần 07)
- [ ] `useUIStore`: ✓ menu dọc thu gọn / ngăn kéo; còn drawer giỏ hàng, modal

### 3.3 Layout dùng chung (từ `skyline/js/layout.js`)
- [x] Header: logo Airlife (wordmark), ô tìm kiếm (form GET, chạy không cần JS), nút Đăng bán, VN/EN (EN chờ i18n), chuông, giỏ hàng, nút tài khoản (avatar khi có đăng nhập)
- [x] Menu dọc (kiểu YouTube): Home · Xem · Nghe · Mới tải · Bạn · Sưu tập; 3 dạng: thanh icon 76px, menu đầy đủ 232px, ngăn kéo (Radix Dialog) cho màn < 1280px. "Kênh đang theo dõi" lấy từ `/me/following` (Phần 05)
- [x] Menu ngang chuyên mục có dropdown tiểu mục (CSS hover + focus-within, dùng được bằng bàn phím): Tiện ích · Tin tức · Kinh doanh · Ý kiến · Tour bay
- [x] Thanh tab mobile
- [ ] Footer: ✓ nền tối, logo trắng, cột chuyên mục/giải trí/liên hệ; còn link MXH (chờ URL Facebook, YouTube, LinkedIn, Cinando) và thông tin pháp nhân Airlife (chờ khách)
- [x] Mini player cố định đáy, thanh Player kiểu đường băng (máy bay ở đầu thanh), tạm dừng giữ nguyên vị trí; điện thoại thu thành vạch mảnh trên thanh tab
- [x] Một trình phát YouTube duy nhất trong AppShell (YouTubeHost): trang xem đặt ô (PlayerSlot), trình phát đè khít lên; rời trang thì thu thành ô nổi 356×200 (YouTube bắt buộc khung ≥ 200×200), không tải lại khi chuyển trang
- [ ] Drawer giỏ hàng
- [x] Trang 404 trong khung chung; link "Bỏ qua menu" cho người dùng bàn phím

### 3.4 Component dùng chung
- [ ] Bọc Radix UI bằng Tailwind theo theme Airlife: DropdownMenu (menu chuyên mục), Dialog/Drawer (modal, giỏ hàng), Tabs, Popover, Tooltip, Slider (âm lượng, tua), Toast
- [ ] Icon (✓ Player icons + icon nét), ✓ Avatar (màu theo tên), ✓ Chip/Filter (link URL), ✓ Badge verified; còn Button, Tabs, Rating sao
- [ ] ✓ MediaCard, MediaTile, FeaturedHero, RankList, Panel; còn ProductCard, ChannelCard, NewsCard, CommentItem, ExperienceCard, SurveyCard
- [ ] ✓ EmptyState, ErrorState (có nút thử lại), ✓ Infinite scroll (IntersectionObserver + nút Xem thêm); còn Skeleton loading
- [ ] Helper format: ✓ số rút gọn (`1,8 Tr`, `54,2 N`), ✓ thời lượng / số tập, ✓ thời gian tương đối, ✓ ngày `dd/mm/yyyy` theo giờ VN; còn giá `vi-VN` + ₫ (Phần 07)

### 3.5 Trang (map từ mockup)

| Mockup | Route Next.js | Ghi chú |
|---|---|---|
| `index.html` | `/` | ✓ Bố cục home theo bản vẽ tay, cột bình luận nổi bật, khối Kinh doanh (còn tiện ích) |
| `chuyen-muc.html?c=xem\|nghe` | `/xem`, `/nghe` | ✓ Chip lọc, sắp xếp, cuộn tải thêm |
| `chuyen-muc.html?c=kinh-doanh\|tour-bay` | `/kinh-doanh`, `/tour-bay` | ✓ Chip lọc `?f=`, Mới nhất / Bán chạy (Phần 07) |
| `tien-ich.html?tab=` | `/tien-ich/[tab]` | Ra tàu bay, Flightradar, thời tiết, Wi-Fi, phòng chờ |
| `y-kien.html?tab=` | `/y-kien/[tab]` | Trải nghiệm, khảo sát, góp ý |
| `tin-tuc.html?f=` | `/tin-tuc` | ✓ Bài nổi bật, chip chuyên mục, cuộn tải thêm |
| `bai-viet.html?id=` | `/tin-tuc/[slug]` | ✓ Thân bài (`prose`), Đọc thêm, Open Graph `article`; ✓ bình luận; còn chia sẻ/lưu |
| `moi-tai.html` | `/moi-tai` | ✓ Tab Tất cả / Video / Nghe / Line-up phim tháng (chọn tháng) |
| `ban.html` | `/ban` | ✓ Cần đăng nhập (`proxy.ts`), thẻ hồ sơ, số liệu, tiếp tục xem, kênh theo dõi; còn chuyến bay (Phần 10), đơn hàng (Phần 07) |
| `suu-tap.html` | `/suu-tap`, `/suu-tap/playlist/[id]` | ✓ Tab Playlist, Đã lưu, Yêu thích, Đã xem; trang playlist |
| `xem.html?id=` | `/xem/[slug]`, `/nghe/[slug]` | ✓ Player YouTube (video & nghe), thông tin, gợi ý, theo dõi kênh, bình luận, Lưu, thêm vào playlist, xem tiếp từ chỗ dừng; còn sản phẩm gắn video |
| `san-pham.html?id=` | `/san-pham/[slug]` | ✓ Hàng hoá: bộ ảnh, biến thể, số lượng, giỏ, yêu thích, JSON-LD (Phần 07); còn vé/tour chọn ngày, số khách (Phần 08) |
| `kenh.html?id=` | `/kenh/[slug]` | ✓ Ảnh bìa, thông tin, theo dõi, lưới nội dung của kênh; còn tab sản phẩm của kênh doanh nghiệp (Phần 07) |
| `lien-he.html` | `/lien-he` | Form liên hệ |
| `tim-kiem.html?q=` | `/tim-kiem` | Kết quả gộp nhiều loại |
| (mới) | `/dang-nhap`, `/dang-ky`, `/quen-mat-khau` | ✓ `/dang-nhap`, `/dang-ky`, `/quen-mat-khau`, `/dat-lai-mat-khau`, `/xac-minh-email` (react-hook-form + zod, lỗi theo từng ô, chống open redirect) |
| (mới) | `/gio-hang`, `/thanh-toan`, `/don-hang`, `/don-hang/[code]` | ✓ Giỏ, thanh toán COD, đơn hàng (Phần 07); thanh toán online Phần 09 |

- [ ] Làm lần lượt từng trang trên, mỗi trang: UI pixel-perfect theo mockup → nối API bằng TanStack Query → loading/error/empty state → responsive
- [ ] Player: ✓ YouTube IFrame Player API, mini player điều khiển bằng icon Player Airlife (phát/dừng, tua 10s, tắt tiếng, thanh đường băng theo thời gian thật), ✓ gửi lượt xem khi bắt đầu phát; còn nhớ tiến độ xem (cần đăng nhập)
- [x] Mục Nghe vẫn hiện khung video YouTube (điều khoản YouTube không cho ẩn video để phát riêng tiếng); thanh Player không đè lên khung video
- [ ] Optimistic update cho like, follow, lưu, thêm giỏ hàng
- [ ] Form dùng `react-hook-form` + `zod`
- [ ] Middleware Next.js bảo vệ route cần đăng nhập

### 3.6 Trang quản trị (CMS)
- [ ] Editor **Tiptap** cho tin tức, mô tả sản phẩm, tour: tiêu đề, đậm/nghiêng, danh sách, link, chèn ảnh (upload lên R2), nhúng YouTube; hiển thị lại HTML đã lọc ở trang public
- [ ] `/admin` (hoặc app riêng): đăng nhập admin, CRUD nội dung, thêm video bằng link YouTube, kiểm duyệt, đơn hàng, thống kê

### 3.7 SEO & hiệu năng
- [ ] Metadata động, Open Graph với logo Airlife, `sitemap.xml`, `robots.txt`, JSON-LD (VideoObject, Product, NewsArticle)
- [ ] Redirect 301 từ URL cũ skyline.vn sang URL mới airlife (nếu đổi domain)
- [ ] `next/image`, lazy load, prefetch, chia nhỏ bundle; mục tiêu Lighthouse ≥ 90
- [ ] Accessibility: điều hướng bàn phím, `aria-*`, tương phản màu

### 3.8 Chất lượng frontend
- [ ] Kiểm tra trên mobile thật (iOS Safari, Android Chrome)

---

## Giai đoạn 4: Tích hợp bên thứ ba
- [ ] Cổng thanh toán (VNPay / MoMo / ZaloPay)
- [ ] Resend: xác minh domain gửi (SPF, DKIM, DMARC trên Cloudflare DNS), địa chỉ gửi vd. `no-reply@airlife.vn`
- [ ] Cloudflare Turnstile: tạo site key/secret key cho dev và prod
- [ ] Dữ liệu chuyến bay (FlightAware / AviationStack / API hãng bay đối tác)
- [ ] Thời tiết (OpenWeather)
- [ ] Bản đồ Flightradar (Mapbox/Leaflet + dữ liệu vị trí)
- [ ] Đăng nhập Google / Facebook
- [ ] YouTube Data API v3 (API key, theo dõi quota 10.000 đơn vị/ngày; cache metadata trong DB)
- [ ] Analytics (GA4 / Umami), Sentry cho cả frontend và backend (**bắt buộc trước khi lên production**)

---

## Giai đoạn 5: Triển khai & vận hành
- [ ] Dockerfile multi-stage cho `frontend` (Next standalone) và `backend` (build 2 binary `api`, `worker` từ `cmd/`, chạy trên distroless)
- [ ] Cloudflare: trỏ DNS qua Cloudflare (proxy bật), SSL Full (strict), bật WAF managed rules, rule cache cho file tĩnh `/_next/static`
- [ ] Nginx: chứng chỉ Cloudflare Origin, chỉ nhận request từ dải IP Cloudflare, lấy IP thật của khách qua `CF-Connecting-IP`, gzip/brotli, proxy `/api`
- [ ] Môi trường staging + production, secrets không commit
- [ ] Backup PostgreSQL hằng ngày, kiểm tra khôi phục
- [ ] Giám sát (**đã chốt 29/10/2026**): CHƯA làm metrics lúc dev. Trước khi lên production: Sentry (bắt lỗi) + Uptime Kuma (gọi `/readyz` mỗi phút, báo khi sập). Prometheus + Grafana (metrics: request/giây, độ trễ p95, tỉ lệ lỗi, độ dài hàng đợi RabbitMQ, kết nối DB) để khi có traffic thật hoặc cần điều tra chậm
- [ ] Ảnh phục vụ qua custom domain R2 (Cloudflare CDN sẵn), đặt cache header dài cho file
- [ ] Nhập dữ liệu thật (line-up phim, tin tức cũ của skyline.vn nếu cần giữ)
- [ ] Trỏ domain, go-live checklist

---

## Thứ tự làm đề xuất

1. Giai đoạn 1 (brand, ERD, OpenAPI, docker-compose)
2. Backend nền tảng + migration + seed → Frontend khởi tạo + layout chung (song song)
3. Luồng chỉ đọc: Home, Xem/Nghe, chi tiết media, Tin tức, Line-up, Kênh, Tìm kiếm
4. Auth → Bạn, Sưu tập, bình luận, theo dõi
5. Thương mại: sản phẩm, vé/tour, giỏ hàng, thanh toán, đơn hàng
6. Tiện ích, Ý kiến, thông báo
7. CMS admin
8. SEO, hiệu năng, triển khai

## Câu hỏi cần chốt với khách
- [ ] Domain mới (airlife.vn?) và có cần redirect từ skyline.vn không
- [ ] Bản quyền font FS Magistral cho web
- [ ] Cổng thanh toán và đơn vị cung cấp dữ liệu chuyến bay
- [ ] Ai được thêm video YouTube (chỉ admin hay cả creator/doanh nghiệp)
- [ ] Nội dung song ngữ: dịch toàn bộ hay chỉ giao diện
- [ ] Admin CMS nằm chung app Next.js hay tách riêng
