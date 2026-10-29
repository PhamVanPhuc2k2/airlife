# Bài 1.01: Logo Airlife và favicon

> [← Phần 00](../00-nen-mong/12-migration-dau-tien.md) · [Mục lục](../README.md) · [Bài sau →](02-khung-nextjs-trong-docker.md)

## Mục tiêu

Có đủ bộ logo Airlife dạng SVG cho web, cùng favicon, icon cho iPhone và ảnh chia sẻ mạng xã hội,
đặt đúng chỗ Next.js tự nhận.

## Bạn sẽ học

- Logo trên web nên là **SVG**: nét sắc ở mọi kích thước, nhẹ, đổi màu được.
- Cần **nhiều bản** logo cho nhiều chỗ: nền sáng, nền tối, chỗ hẹp, favicon.
- File PDF/AI của designer thường là vector: logo nằm bên trong dưới dạng lệnh vẽ, tách ra được.
- Quy ước file đặc biệt của Next.js App Router: `favicon.ico`, `icon.svg`, `apple-icon.png`, `opengraph-image.png`.

## Viết code

### Bước 1: Bộ nhận diện

Từ `Brand Airlife.pdf` của designer:

| Mục | Giá trị |
|---|---|
| Màu chính | `#6C3C8B` (tím) |
| Màu phụ | gradient `#C86E3A` → `#F8AC3F` (cam đồng → vàng cam) |
| Font logo | FS Magistral Bold (chữ logo đã vẽ thành nét, không cần font) |
| Slogan | "Đời sống hàng không" |

Font chữ của web dùng **Be Vietnam Pro** (Google Fonts, miễn phí, đủ dấu tiếng Việt), vì
FS Magistral chưa rõ bản quyền dùng trên web. Logo vẫn đúng font gốc vì chữ trong logo đã là nét vẽ.

### Bước 2: Logo được tách ra khỏi PDF như thế nào

Đây là phần **đọc hiểu**, không cần gõ lại. File PDF xuất từ CorelDRAW lưu logo dưới dạng
lệnh vẽ trong "content stream" (nén bằng zlib). Giải nén ra sẽ thấy dạng:

```text
/CS14 cs 0.7490 1.0000 0.0784 0.0078 scn    ← chọn màu CMYK (tím)
403.0710 441.5689 m                         ← moveto: đặt bút ở toạ độ (x, y)
410.7342 441.5689 l                         ← lineto: kẻ thẳng tới
...                                         ← (các dòng "x1 y1 x2 y2 x3 y3 c": đường cong Bézier)
h                                           ← đóng hình
f*                                          ← tô màu, quy tắc even-odd
/Sh16 sh                                    ← tô gradient (shading)
```

Lệnh PDF và lệnh `<path d="...">` của SVG gần như một-một: `m`→`M`, `l`→`L`, `c`→`C`, `h`→`Z`.
Khác biệt duy nhất: trục y của PDF hướng **lên**, của SVG hướng **xuống**, nên mọi toạ độ y đổi
thành `chiều cao trang − y`.

Đoạn đầu trang có đúng 5 hình của logo:

| Hình | Cách tô trong PDF | Trong SVG |
|---|---|---|
| Đuôi máy bay | màu tím, `f*` | `fill="#6C3C8B" fill-rule="evenodd"` |
| Cánh | vùng cắt `W*` + gradient `/Sh16` | `fill="url(#al-wing)"` |
| Chữ AIR | màu tím, `f*` | `fill="#6C3C8B"` |
| Chữ LIFE | vùng cắt `W` + gradient `/Sh19` (dọc) | `fill="url(#al-life)"` |
| Slogan | màu tím, `f` | `fill="#6C3C8B"` |

Gradient trong PDF ghi màu CMYK: `C0 [0.004 0.365 0.914 0]` = C1 M37 Y92 K0 = `#F8AC3F`, khớp đúng
bảng màu của designer. Gradient của cánh có số mũ `N 1.737` (màu chuyển không đều), nên SVG dùng
6 điểm dừng để mô phỏng.

Kết quả được kiểm tra bằng cách vẽ SVG ra PNG (`rsvg-convert`) và so với bản PDF.

### Bước 3: Chép file vào repo

File nhị phân và SVG sinh tự động thì **chép, không gõ** (xem "Chuẩn bị một lần" trong mục lục):

```bash
for f in airlife-logo airlife-logo-white airlife-wordmark airlife-wordmark-white airlife-mark; do
  lay frontend/public/brand/$f.svg
done
for f in favicon.ico icon.svg apple-icon.png opengraph-image.png; do
  lay frontend/src/app/$f
done
```

| File | Dùng ở đâu |
|---|---|
| `public/brand/airlife-logo.svg` | Logo đầy đủ có slogan: trang giới thiệu, email, trang đăng nhập |
| `public/brand/airlife-logo-white.svg` | Như trên, cho nền tối (footer). Phần tím đổi thành trắng, phần cam giữ nguyên |
| `public/brand/airlife-wordmark.svg` | Không slogan: **header** (cao ~32px thì slogan quá nhỏ, không đọc được) |
| `public/brand/airlife-wordmark-white.svg` | Như trên, nền tối |
| `public/brand/airlife-mark.svg` | Chỉ biểu tượng máy bay, khung vuông: menu thu gọn, avatar kênh Airlife |
| `src/app/favicon.ico` | Icon tab trình duyệt (16, 32, 48px gộp một file), cho trình duyệt cũ |
| `src/app/icon.svg` | Icon tab cho trình duyệt mới, nét sắc ở mọi độ phân giải |
| `src/app/apple-icon.png` | 180×180, khi "Thêm vào màn hình chính" trên iPhone. Nền trắng vì iOS không nhận nền trong suốt |
| `src/app/opengraph-image.png` | 1200×630, ảnh hiện khi chia sẻ link lên Facebook, Zalo |

Next.js App Router **tự** sinh thẻ `<link rel="icon">`, `<meta property="og:image">` khi thấy các
file tên đúng như trên trong thư mục `app/`. Không cần khai báo gì thêm.

### Bước 4: Vì sao SVG có `<title>` và `role="img"`

Mở `airlife-mark.svg` sẽ thấy:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="..." role="img" aria-label="Airlife">
<title>Airlife</title>
```

Trình đọc màn hình (người khiếm thị) đọc "Airlife" thay vì bỏ qua hay đọc "hình ảnh". Khi
nhúng bằng `<img>` thì thêm `alt="Airlife"`, bài layout sẽ làm.

## Kiểm tra

```bash
ls frontend/public/brand frontend/src/app
file frontend/src/app/*
# apple-icon.png:      PNG image data, 180 x 180
# favicon.ico:         MS Windows icon resource - 3 icons
# opengraph-image.png: PNG image data, 1200 x 630
```

Mở từng file `.svg` bằng trình duyệt (kéo thả vào tab mới): logo hiện đúng màu, phóng to tối đa
vẫn sắc nét. Bản `-white` mở trên nền trắng sẽ khó thấy phần chữ, đó là đúng.

```bash
git add frontend && git commit -m "Logo Airlife, favicon, ảnh Open Graph"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Logo SVG bị đen hoặc mất gradient khi nhúng inline nhiều lần trên một trang | `id` của gradient (`al-wing`, `al-life`) bị trùng giữa các bản inline. Nhúng bằng `<img src>` (cách khoá này dùng) thì không bị |
| Favicon không đổi sau khi thay file | Trình duyệt cache favicon rất lâu. Mở tab ẩn danh hoặc xoá cache |
| Ảnh chia sẻ Facebook vẫn là ảnh cũ | Facebook cache. Dùng Sharing Debugger của Facebook để làm mới |
