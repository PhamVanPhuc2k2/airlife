# Học bằng cách dựng lại Airlife

Khoá này dựng Airlife **từ một thư mục trống**, theo đúng thứ tự dự án được làm:
nền móng trước, rồi từng module. Mỗi bài thêm một phần code, giải thích vì sao nó
được viết như vậy, rồi kiểm bằng build, lint và chạy thật.

Mã trong bài lấy **nguyên văn** từ repo `~/tnp/airlife`, nên khớp với mã đang chạy.
Bài được viết dần theo tiến độ dự án: làm xong task nào thì có bài của task đó.

---

## Cách học

1. **Gõ, đừng chép-dán.** Mọi file code và cấu hình đều in đầy đủ trong bài. Chú
   thích trong code là phần quan trọng nhất, đọc kỹ trước khi gõ.
2. **Cài thư viện ở bài đầu tiên dùng nó**, bằng lệnh có phiên bản chính xác
   (`go get <module>@<phiên bản>`). Không chép `go.mod`, `go.sum`; hai file này do lệnh sinh ra.
3. **Chưa qua mục "Kiểm tra" thì chưa sang bài sau.** Lỗi ở bài 3 để tới bài 8 mới
   thấy thì rất khó lần ra.
4. **Thử phá.** Đọc một chú thích "vì sao", sửa dòng đó rồi chạy lại, để thấy dòng đó
   bảo vệ điều gì.
5. **Gõ xong thì `doichieu`** file của bạn với bản gốc.
6. **Commit sau mỗi bài.** Hỏng thì quay lại được điểm cuối cùng còn chạy.

### Mỗi bài có cùng một khuôn

| Mục | Để làm gì |
|---|---|
| Mục tiêu | Xong bài này thì có gì |
| Bạn sẽ học | Ý tưởng chính, thứ đáng nhớ hơn cả code |
| Viết code | Từng file theo thứ tự gõ: vì sao có nó, điểm chính, code |
| Kiểm tra | Lệnh chạy và kết quả phải ra |
| Hay gặp lỗi | Lỗi dễ gặp và cách gỡ |

---

## Chuẩn bị một lần

**Dự án chạy hoàn toàn bằng Docker**: PostgreSQL, Redis, RabbitMQ, API, worker (và frontend
ở phần sau) đều là container. Air, golang-migrate, golangci-lint, govulncheck cũng chạy trong
container, không cần cài lên máy.

Cần trên máy: **Docker** + Docker Compose v2, **make**, **git**. Thêm **Go 1.27.3** để editor
gợi ý code và để chạy `go build` kiểm tra nhanh ở các bài 0.03–0.09 (trước khi có Dockerfile).
Node.js **không** cần trên máy: frontend cài gói và chạy trong container Node 24.22.1.
**Đừng** chạy `npm install` trên máy (xem bài 1.02).

```bash
docker --version && docker compose version && make --version && git --version && go version
```

Repo học đặt cạnh repo gốc:

```bash
mkdir -p ~/tnp/airlife-hoc
```

Thêm vào `~/.bashrc`, rồi mở terminal mới. `GOC` trỏ tới repo gốc, chỉ để đọc và
đối chiếu, **không sửa gì trong đó**.

```bash
export GOC=~/tnp/airlife

# So file bạn gõ với bản gốc:   doichieu backend/internal/config/config.go
doichieu() { diff -u "$GOC/$1" "$1" && echo "✓ khớp: $1"; }

# Chép nguyên một file từ bản gốc, CHỈ dùng cho file nhị phân (ảnh, logo, font)
lay() { mkdir -p "$(dirname "$1")" && cp "$GOC/$1" "$1"; }
```

`doichieu` in từng dòng khác nhau. Khác ở chú thích thì không sao; khác ở code là
chỗ cần xem lại.

### File lớn dần

Vài file được viết nhiều lần khi dự án lớn lên: `cmd/api/main.go`,
`cmd/worker/main.go`, `internal/server/server.go`, `internal/config/config.go`,
`docker-compose.yml`, `Makefile`… Bài đầu viết bản khởi đầu, các phần sau in **đoạn cần thêm**. Chưa tới
phần cuối thì `doichieu` các file này còn báo khác, đó là đúng như dự kiến.

---

## Mục lục

### Phần 00: Nền móng

Repo, hạ tầng Docker, khung backend Go (config, log, lỗi, kết nối, middleware, router,
api, worker), Dockerfile, công cụ dev, migration đầu tiên. Cuối phần: `make up` chạy cả hệ
thống trong Docker; `/readyz` báo đủ ba dịch vụ; `make migrate`, `make lint`, `make vuln` sạch.

| Bài | Nội dung |
|---|---|
| [0.01](00-nen-mong/01-khoi-tao-repo.md) | Khởi tạo repo và bản đồ dự án |
| [0.02](00-nen-mong/02-ha-tang-docker-compose.md) | Hạ tầng dev: PostgreSQL, Redis, RabbitMQ bằng Docker Compose |
| [0.03](00-nen-mong/03-module-go-va-cau-truc.md) | Module Go và cấu trúc thư mục `backend/` |
| [0.04](00-nen-mong/04-cau-hinh-viper.md) | Cấu hình bằng viper: `.env`, biến môi trường, chết sớm khi thiếu |
| [0.05](00-nen-mong/05-log-loi-phan-hoi.md) | Log, lỗi theo ngữ nghĩa, định dạng phản hồi JSON |
| [0.06](00-nen-mong/06-ket-noi-ha-tang.md) | Kết nối PostgreSQL, Redis, RabbitMQ |
| [0.07](00-nen-mong/07-middleware.md) | Middleware: IP thật sau Cloudflare, log request, bắt panic |
| [0.08](00-nen-mong/08-router-va-health.md) | Router go-chi, CORS, health check |
| [0.09](00-nen-mong/09-cmd-api-va-worker.md) | `cmd/api` và `cmd/worker`: nối dây và tắt êm |
| [0.10](00-nen-mong/10-docker-va-air.md) | Dockerfile nhiều target, chạy api/worker trong Docker với air |
| [0.11](00-nen-mong/11-lint-vuln-makefile.md) | golangci-lint, govulncheck, Makefile |
| [0.12](00-nen-mong/12-migration-dau-tien.md) | Migration đầu tiên: tìm kiếm tiếng Việt không dấu |

### Phần 01: Thương hiệu và giao diện

Logo Airlife, khung Next.js chạy trong Docker, theme Tailwind, layout chung (header, menu, footer, mini player).

| Bài | Nội dung |
|---|---|
| [1.01](01-thuong-hieu-va-giao-dien/01-logo-va-favicon.md) | Logo Airlife và favicon |
| [1.02](01-thuong-hieu-va-giao-dien/02-khung-nextjs-trong-docker.md) | Khung Next.js chạy trong Docker |
| [1.03](01-thuong-hieu-va-giao-dien/03-theme-tailwind-va-font.md) | Theme Tailwind và font Be Vietnam Pro |
| [1.04](01-thuong-hieu-va-giao-dien/04-icon-va-cau-hinh-menu.md) | Icon và cấu hình menu |
| [1.05](01-thuong-hieu-va-giao-dien/05-header-va-menu-ngang.md) | Header và menu ngang, store Zustand đầu tiên |
| [1.06](01-thuong-hieu-va-giao-dien/06-menu-doc-tab-footer.md) | Menu dọc ba dạng (Radix Dialog), thanh tab, footer |
| [1.07](01-thuong-hieu-va-giao-dien/07-mini-player.md) | Mini player và thanh Player đường băng |
| [1.08](01-thuong-hieu-va-giao-dien/08-ghep-khung-appshell.md) | Ghép khung `AppShell`, trang 404, nghiệm thu layout |

### Phần 02: Nội dung Xem/Nghe

Schema nội dung, sqlc, dữ liệu mẫu, API chuyên mục/media/trang chủ, cache Redis, phân trang con trỏ,
đếm lượt xem bằng Redis + worker. Frontend: TanStack Query, trang chủ, trang chuyên mục cuộn tải thêm,
trang xem với trình phát YouTube phát tiếp khi chuyển trang.

| Bài | Nội dung |
|---|---|
| [2.01](02-noi-dung-xem-nghe/01-schema-noi-dung.md) | Schema nội dung: chuyên mục, kênh, media |
| [2.02](02-noi-dung-xem-nghe/02-sqlc.md) | sqlc: viết SQL, sinh code Go |
| [2.03](02-noi-dung-xem-nghe/03-du-lieu-mau-seed.md) | Dữ liệu mẫu và `cmd/seed` |
| [2.04](02-noi-dung-xem-nghe/04-category-va-cache.md) | Module chuyên mục và cache Redis |
| [2.05](02-noi-dung-xem-nghe/05-module-media.md) | Module media: repository, service, phân trang con trỏ |
| [2.06](02-noi-dung-xem-nghe/06-dem-luot-xem.md) | Đếm lượt xem bằng Redis, gom ở worker |
| [2.07](02-noi-dung-xem-nghe/07-trang-chu-va-noi-day.md) | API trang chủ, nối dây router, kiểm tra toàn bộ |
| [2.08](02-noi-dung-xem-nghe/08-goi-api-tu-nextjs.md) | Gọi API từ Next.js: hai địa chỉ, `ApiError`, định dạng |
| [2.09](02-noi-dung-xem-nghe/09-tanstack-query.md) | TanStack Query: cài đặt và khai báo truy vấn |
| [2.10](02-noi-dung-xem-nghe/10-trang-chu.md) | Thẻ media và trang chủ |
| [2.11](02-noi-dung-xem-nghe/11-trang-chuyen-muc.md) | Trang chuyên mục: chip lọc, cuộn tải thêm, prefetch + hydrate |
| [2.12](02-noi-dung-xem-nghe/12-trinh-phat-youtube.md) | Trang xem và trình phát YouTube xuyên trang |

### Phần 03: Tin tức và line-up phim

Phần giữ lại từ site cũ skyline.vn. Gói phân trang dùng chung, lọc HTML chống XSS (bluemonday), tin
tức theo chuyên mục, trang bài viết, trang Mới tải với line-up phim theo tháng.

| Bài | Nội dung |
|---|---|
| [3.01](03-tin-tuc-va-line-up/01-phan-trang-chung-va-loc-html.md) | Gói phân trang dùng chung, lọc HTML bằng bluemonday |
| [3.02](03-tin-tuc-va-line-up/02-schema-tin-tuc.md) | Schema và truy vấn tin tức, tháng line-up |
| [3.03](03-tin-tuc-va-line-up/03-seed-tin-tuc.md) | Dữ liệu mẫu tin tức, lọc HTML ngay trong seed |
| [3.04](03-tin-tuc-va-line-up/04-module-news.md) | Module tin tức, API tháng line-up |
| [3.05](03-tin-tuc-va-line-up/05-component-dung-chung.md) | Tách component dùng chung ở frontend |
| [3.06](03-tin-tuc-va-line-up/06-trang-tin-tuc.md) | Trang Tin tức và trang bài viết |
| [3.07](03-tin-tuc-va-line-up/07-trang-moi-tai-line-up.md) | Trang Mới tải và line-up phim theo tháng |

### Phần 04: Đăng nhập và tài khoản

Làm trước Kênh/Bình luận vì các phần đó cần biết ai đang dùng. Băm mật khẩu argon2id, access token JWT
+ refresh token xoay vòng trong Redis, cookie HttpOnly, chặn dò mật khẩu, chống CSRF, tự làm mới phiên
ở frontend, trang đăng nhập/đăng ký, trang Bạn. Hàng đợi job có thử lại, gửi mail ở worker (Mailpit khi
dev), xác minh email, quên/đặt lại mật khẩu.

| Bài | Nội dung |
|---|---|
| [4.01](04-dang-nhap-tai-khoan/01-tong-quan-va-schema.md) | Tổng quan đăng nhập, cấu hình và bảng `users` |
| [4.02](04-dang-nhap-tai-khoan/02-bam-mat-khau.md) | Băm mật khẩu bằng argon2id, đọc JSON an toàn |
| [4.03](04-dang-nhap-tai-khoan/03-access-va-refresh-token.md) | Access token JWT và refresh token xoay vòng |
| [4.04](04-dang-nhap-tai-khoan/04-dang-ky-dang-nhap.md) | Đăng ký, đăng nhập, chặn dò mật khẩu |
| [4.05](04-dang-nhap-tai-khoan/05-cookie-middleware-csrf.md) | Cookie, middleware xác thực, chống CSRF, thử toàn bộ API |
| [4.06](04-dang-nhap-tai-khoan/06-frontend-phien-dang-nhap.md) | Frontend: gửi cookie, tự làm mới phiên, `useMe` |
| [4.07](04-dang-nhap-tai-khoan/07-trang-dang-nhap-dang-ky.md) | Trang đăng nhập và đăng ký |
| [4.08](04-dang-nhap-tai-khoan/08-menu-tai-khoan-trang-ban.md) | Menu tài khoản, trang Bạn, `proxy.ts` |
| [4.09](04-dang-nhap-tai-khoan/09-mailpit-va-hang-doi-job.md) | Mailpit và hàng đợi job (thử lại, dead-letter) |
| [4.10](04-dang-nhap-tai-khoan/10-gui-mail-o-worker.md) | Gửi mail ở worker: SMTP, mẫu email, consumer |
| [4.11](04-dang-nhap-tai-khoan/11-xac-minh-email-quen-mat-khau.md) | Xác minh email và quên mật khẩu (backend) |
| [4.12](04-dang-nhap-tai-khoan/12-frontend-xac-minh-dat-lai.md) | Frontend: xác minh email, quên và đặt lại mật khẩu; nghiệm thu Phần 04 |

### Phần 05: Kênh và bình luận

Trang kênh và theo dõi kênh (transaction giữ số đếm đúng), bình luận cho video và bài viết: trả lời một
cấp, thích, xoá, chỉ tài khoản đã xác minh email được viết, giới hạn tốc độ. Cột "Bình luận nổi bật" ở
trang chủ, danh sách kênh đang theo dõi ở menu dọc.

| Bài | Nội dung |
|---|---|
| [5.01](05-kenh-va-binh-luan/01-schema-theo-doi-binh-luan.md) | Schema theo dõi kênh và bình luận |
| [5.02](05-kenh-va-binh-luan/02-module-kenh.md) | Module kênh: trang kênh, theo dõi trong transaction |
| [5.03](05-kenh-va-binh-luan/03-module-binh-luan.md) | Module bình luận: viết, trả lời, thích, xoá |
| [5.04](05-kenh-va-binh-luan/04-api-va-trang-chu.md) | Nối route, bình luận nổi bật ở trang chủ, request bị huỷ |
| [5.05](05-kenh-va-binh-luan/05-du-lieu-mau-va-thu-api.md) | Dữ liệu mẫu và thử toàn bộ API |
| [5.06](05-kenh-va-binh-luan/06-frontend-kenh-va-theo-doi.md) | Frontend: trang kênh và nút Theo dõi |
| [5.07](05-kenh-va-binh-luan/07-frontend-binh-luan.md) | Frontend: khung bình luận |
| [5.08](05-kenh-va-binh-luan/08-binh-luan-noi-bat-va-menu.md) | Bình luận nổi bật, kênh đang theo dõi; nghiệm thu Phần 05 |

### Các phần sẽ viết tiếp (theo TASKS.md)

| Phần | Nội dung |
|---|---|
| 06 ban-va-suu-tap | Trang Bạn, Sưu tập, tiếp tục xem |
| 07 ban-hang | Sản phẩm, biến thể, giỏ hàng, đơn hàng |
| 08 ve-va-tour | Lịch khởi hành, hạng dịch vụ, giữ chỗ bằng lock Redis |
| 09 thanh-toan | Cổng thanh toán, webhook |
| 10 tien-ich | Chuyến bay, thời tiết, Flightradar |
| 11 y-kien | Trải nghiệm, khảo sát, góp ý, Turnstile |
| 12 cms | Trang quản trị, Tiptap, upload ảnh lên R2 |
| 13 trien-khai | Docker production, Cloudflare, nginx, CI |
