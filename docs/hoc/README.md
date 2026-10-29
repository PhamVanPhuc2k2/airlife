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

### Các phần sẽ viết tiếp (theo TASKS.md)

| Phần | Nội dung |
|---|---|
| 01 thuong-hieu-va-giao-dien | Logo Airlife, theme Tailwind, khung Next.js, layout chung (header, menu, footer, mini player) |
| 02 noi-dung-xem-nghe | Danh mục, media từ YouTube, Player, lượt xem |
| 03 tin-tuc-va-line-up | Tin tức, line-up phim theo tháng |
| 04 kenh-va-binh-luan | Kênh, theo dõi, bình luận |
| 05 dang-nhap-tai-khoan | Đăng ký, đăng nhập, JWT, phiên trên Redis, email qua Resend |
| 06 ban-va-suu-tap | Trang Bạn, Sưu tập, tiếp tục xem |
| 07 ban-hang | Sản phẩm, biến thể, giỏ hàng, đơn hàng |
| 08 ve-va-tour | Lịch khởi hành, hạng dịch vụ, giữ chỗ bằng lock Redis |
| 09 thanh-toan | Cổng thanh toán, webhook |
| 10 tien-ich | Chuyến bay, thời tiết, Flightradar |
| 11 y-kien | Trải nghiệm, khảo sát, góp ý, Turnstile |
| 12 cms | Trang quản trị, Tiptap, upload ảnh lên R2 |
| 13 trien-khai | Docker production, Cloudflare, nginx, CI |
