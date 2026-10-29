# Bài 0.01: Khởi tạo repo và bản đồ dự án

> [Mục lục](../README.md) · [Bài sau →](02-ha-tang-docker-compose.md)

## Mục tiêu

Có repo `~/tnp/airlife-hoc` với git, ba file quy ước (`.gitignore`, `.gitattributes`,
`.editorconfig`) và `README.md`. Quan trọng hơn: bạn biết **mỗi phần của dự án sẽ nằm ở đâu**.

## Bạn sẽ học

- Airlife là **monorepo**: backend Go, frontend Next.js, hạ tầng và tài liệu chung một repo.
  Sửa API và trang dùng API đó trong cùng một commit.
- Ba file quy ước chặn những lỗi tốn thời gian nhất: lộ mật khẩu lên git, lỗi CRLF khi
  build Docker, lệch thụt lề giữa các editor.

## Viết code

### Bước 1: Tạo repo

```bash
mkdir -p ~/tnp/airlife-hoc && cd ~/tnp/airlife-hoc
git init -b main
mkdir -p backend frontend docs
```

`-b main` đặt tên nhánh mặc định là `main` thay vì `master`, khớp với GitHub.

**Mọi lệnh trong khoá chạy từ gốc repo**, trừ khi bài ghi rõ `cd backend` hay `cd frontend`.

### Bước 2: Bản đồ dự án

```
airlife/
├── backend/      # Go 1.27: API (go-chi) + worker (RabbitMQ), 1 module, 2 chương trình
├── frontend/     # Next.js 16 + Tailwind 3.4.17 + Zustand + TanStack Query
├── docs/hoc/     # khoá học này
├── docker-compose.yml  # cả hệ thống chạy trong Docker
├── Makefile      # lệnh tắt: make up, make logs, make migrate…
└── TASKS.md      # danh sách task của dự án
```

Dòng đi của một request:

```
Trình duyệt → Cloudflare → nginx → frontend (Next.js)
                                 → backend api (Go) → PostgreSQL / Redis
                                                    → RabbitMQ → backend worker (email, job nền)
Video, âm thanh: nhúng YouTube.  Ảnh: Cloudflare R2.
```

### Bước 3: Ba file quy ước

#### `.gitignore`

Liệt kê thứ git **không** theo dõi. Quan trọng nhất là `.env`: file này chứa mật khẩu DB,
API key. Đẩy nhầm lên GitHub một lần là nó nằm trong lịch sử git vĩnh viễn, xoá commit
sau cũng không gỡ được khỏi các bản đã clone. Cách xử lý duy nhất lúc đó là đổi hết mật khẩu.

Mẫu `!.env.example` (có dấu `!`) là ngoại lệ: file mẫu không chứa bí mật nên **được** commit,
để người mới biết cần đặt những biến nào.

```gitignore
# Hệ điều hành / editor
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# Biến môi trường (chỉ commit file *.example)
.env
.env.*
!.env.example

# Backend
backend/tmp/
backend/bin/

# Frontend
frontend/node_modules/
frontend/.next/
frontend/out/
frontend/next-env.d.ts
*.tsbuildinfo

# Log
*.log
```

#### `.gitattributes`

Windows dùng CRLF (`\r\n`) cuối dòng, Linux dùng LF (`\n`). Nếu một file `.sh` dính CRLF
rồi chạy trong container Linux, bạn gặp lỗi khó hiểu kiểu `exec format error` hay
`/bin/sh^M: not found`. File này bắt git luôn lưu LF.

```gitattributes
# Mặc định: git tự chuẩn hoá xuống LF khi lưu vào repo.
* text=auto eol=lf

# File chạy trong container Linux: bắt buộc LF.
# Dính CRLF (clone trên Windows) là gặp "exec format error" khi build Docker.
*.sh   text eol=lf
*.go   text eol=lf
*.sql  text eol=lf
Makefile text eol=lf

# File nhị phân: không đụng vào.
*.png  binary
*.jpg  binary
*.webp binary
*.ico  binary
*.pdf  binary
*.woff2 binary

# File sinh tự động: GitHub thu gọn khi xem diff.
go.sum            linguist-generated=true
package-lock.json linguist-generated=true
```

`linguist-generated` báo GitHub thu gọn `go.sum` khi xem diff, vì file này do máy sinh, không ai đọc.

#### `.editorconfig`

VS Code, GoLand… đều đọc file này để thống nhất cách thụt lề. Go **bắt buộc** tab (gofmt),
Makefile **bắt buộc** tab trước lệnh (dùng dấu cách là `make` báo `missing separator`).

```ini
# Mọi editor (VS Code, GoLand…) đọc file này để thống nhất thụt lề, cuối dòng.
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

# gofmt bắt buộc dùng tab cho Go; Makefile bắt buộc tab trước lệnh.
[{*.go,Makefile,go.mod}]
indent_style = tab
indent_size = 4

# Hai dấu cách cuối dòng là ngắt dòng trong Markdown, không được xoá.
[*.md]
trim_trailing_whitespace = false
```

### Bước 4: README

```markdown
# Airlife — Đời sống hàng không

Mạng xã hội trên không cho khách bay và doanh nghiệp: xem phim, nghe, mua sắm, vé bay, tour, tiện ích chuyến bay.

| Thư mục | Nội dung |
|---|---|
| `backend/` | Go 1.27: API (go-chi) và worker (RabbitMQ) |
| `frontend/` | Next.js 16, Tailwind 3.4.17, Zustand, TanStack Query |
| `docker-compose.yml` | Cả hệ thống chạy bằng Docker: `make up` |
| `docs/hoc/` | Khoá học dựng lại dự án từng bước |
| `TASKS.md` | Danh sách task |

Bắt đầu từ [docs/hoc/README.md](docs/hoc/README.md).
```

### Bước 5: Nối với GitHub

Tạo repo rỗng trên GitHub (không tick "Add README"), rồi:

```bash
git remote add origin https://github.com/<tài-khoản>/airlife-hoc.git
git remote -v
```

## Kiểm tra

```bash
git status
```

Phải thấy 4 file chưa commit: `.editorconfig`, `.gitattributes`, `.gitignore`, `README.md`.
Thư mục rỗng (`backend/`, `frontend/`…) **không** hiện, vì git chỉ theo dõi file, không theo dõi thư mục rỗng.

Thử `.gitignore` có chặn `.env` không:

```bash
touch backend/.env backend/.env.example
git status --short backend/
```

Chỉ thấy `backend/.env.example`, không thấy `backend/.env`. Xoá hai file thử: `rm backend/.env backend/.env.example`.

Commit:

```bash
git add . && git commit -m "Khởi tạo repo"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `.env` vẫn hiện trong `git status` | File đã từng được `git add` trước khi có `.gitignore`. Chạy `git rm --cached backend/.env` |
| `git push` hỏi mật khẩu rồi báo lỗi | GitHub không nhận mật khẩu tài khoản nữa; dùng Personal Access Token hoặc SSH key |
