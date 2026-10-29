# Bài 1.03: Theme Tailwind và font Be Vietnam Pro

> [← Bài trước](02-khung-nextjs-trong-docker.md) · [Mục lục](../README.md)

## Mục tiêu

Tailwind dùng được màu, bóng, gradient, kích thước khung của Airlife (`bg-brand-600`,
`text-accent-700`, `h-header`…). Font Be Vietnam Pro tự host. Một trang tạm để nhìn toàn bộ theme.

## Bạn sẽ học

- Chuyển biến SCSS của mockup (`_variables.scss`) sang `tailwind.config.ts`.
- Tạo **thang màu** 50…950 từ một màu gốc, và kiểm tra **độ tương phản** trước khi dùng.
- Mobile-first (Tailwind) khác desktop-first (mockup) thế nào.
- `next/font`: tự host font, không nháy chữ, không gọi sang Google khi khách mở trang.

## Viết code

### Bước 1: Từ SCSS sang Tailwind

Mockup Skyline có `scss/_variables.scss`: biến màu, bóng, bán kính, kích thước khung. Trong Tailwind,
những thứ này nằm trong `theme.extend` của `tailwind.config.ts`, và mỗi biến thành một **class**:

| Mockup (SCSS) | Airlife (Tailwind) | Dùng |
|---|---|---|
| `$brand-400: #3b82f6` (xanh) | `brand.600: #6c3c8b` (tím logo) | `bg-brand-600`, `text-brand-600` |
| `$accent: #ff5a36` (cam san hô) | `accent.600: #c86e3a` (cam logo) | `text-accent-700` |
| `$surface-2` | `surface.2` | `bg-surface-2` |
| `$radius: 16px` | `borderRadius.card` | `rounded-card` |
| `$shadow-brand` | `boxShadow.brand` | `shadow-brand` |
| `$header-h: 64px` | `spacing.header` | `h-header`, `pt-header` |
| `$gradient-brand` | `backgroundImage.gradient-brand` | `bg-gradient-brand` |

### Bước 2: Thang màu và độ tương phản

Bộ nhận diện chỉ có **một** màu tím `#6C3C8B` và hai đầu cam. Giao diện cần nhiều sắc độ: nền
nhạt cho chip, hover đậm hơn, chữ trên nền tối… Cách làm:

- Tông **nhạt** (50→500): pha màu gốc với **trắng** 95%, 90%, 75%, 55%, 30%, 12%.
- Màu gốc đặt ở **600**.
- Tông **đậm** (700→950): pha với **đen** 18%, 35%, 50%, 65%.

Rồi đo **độ tương phản** với nền trắng theo chuẩn WCAG (chữ thường cần ≥ 4.5:1, chữ lớn/icon ≥ 3:1):

| Màu | Tương phản với trắng | Kết luận |
|---|---|---|
| `brand-600` #6c3c8b | 7.9 | Chữ, link, nút chữ trắng: đạt |
| `brand-500` #7e5399 | 5.9 | Đạt |
| `accent-600` #c86e3a | **3.65** | **Không đạt** cho chữ nhỏ. Chỉ dùng chữ lớn, icon, trang trí |
| `accent-700` #a45a30 | 5.1 | Chữ nhỏ màu cam (giá tiền), nút cam chữ trắng |
| `accent.light` #f8ac3f | 1.9 | Chỉ làm nền (chữ đen trên nó) hoặc trang trí |

Đây là lý do nút "Mua ngay" dùng `bg-accent-700` chứ không phải màu cam của logo: màu logo
đẹp nhưng chữ trắng trên đó khó đọc với người mắt kém, và dưới nắng trên điện thoại.

### Bước 3: `frontend/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

// Theme Airlife, chuyển từ skyline/scss/_variables.scss của mockup, đổi bảng màu sang
// bộ nhận diện Airlife (Brand Airlife.pdf):
//   brand  = tím #6C3C8B (Màu 1)
//   accent = cam đồng #C86E3A → vàng cam #F8AC3F (Màu 2, dải màu)
//
// Thang 50…950: tông nhạt = pha màu gốc với trắng, tông đậm = pha với đen.
// Độ tương phản với nền trắng (chuẩn WCAG AA: chữ thường ≥ 4.5, chữ lớn/icon ≥ 3):
//   brand-500 5.9 · brand-600 7.9 → chữ, link, nút chữ trắng đều đạt
//   accent-600 3.65 → CHỈ dùng cho chữ lớn, icon, nền trang trí
//   accent-700 5.1  → chữ nhỏ màu cam (giá tiền), nút cam chữ trắng
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // Mockup viết desktop-first (max-width 767/1024/1280/1536); Tailwind mobile-first.
    // Các mốc trùng với md/lg/xl/2xl mặc định, chỉ thêm xs cho điện thoại nhỏ.
    screens: {
      xs: "400px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        brand: {
          50: "#f8f5f9",
          100: "#f0ecf3",
          200: "#dacee2",
          300: "#bda7cb", // chữ/icon brand trên nền tối
          400: "#9876ae",
          500: "#7e5399",
          600: "#6c3c8b", // màu chính của logo
          700: "#593172",
          800: "#46275a",
          900: "#361e46",
          950: "#261531",
          DEFAULT: "#6c3c8b",
        },
        accent: {
          50: "#fcf8f5",
          100: "#faf0eb",
          200: "#f1dbce",
          300: "#e6bea6",
          400: "#d89a75",
          500: "#cf7f52",
          600: "#c86e3a", // đầu đậm của dải màu logo
          700: "#a45a30",
          800: "#824826",
          900: "#64371d",
          950: "#462614",
          light: "#f8ac3f", // đầu sáng của dải màu logo
          DEFAULT: "#c86e3a",
        },
        // Nền & bề mặt (giữ từ mockup: trắng xám lạnh)
        bg: "#f5f7fb",
        surface: {
          DEFAULT: "#ffffff",
          2: "#eef2f8", // chip, hover, ô phụ
          3: "#e2e8f0", // hover đậm hơn
          4: "#cbd5e1", // sao chưa chọn, viền đậm
        },
        // Chữ
        ink: {
          DEFAULT: "#0f172a", // chữ chính
          2: "#334155",
          muted: "#64748b",
          dim: "#94a3b8",
        },
        overlay: "#0b1220", // lớp phủ ảnh, footer, bản đồ Flightradar
        // Trạng thái
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#dc2626",
        flying: "#0284c7", // "đang bay" trên nền sáng
        // Thanh Player kiểu đường băng (đúng màu file thiết kế Player)
        runway: {
          track: "#3f4247",
          dash: "#a4a8b3",
          off: "#b7b7b7",
        },
      },
      fontFamily: {
        // --font-sans do next/font sinh ra trong layout.tsx
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        "card-sm": "10px",
      },
      boxShadow: {
        sm: "0 1px 2px rgb(15 23 42 / 0.04), 0 2px 8px rgb(15 23 42 / 0.04)",
        md: "0 10px 30px rgb(15 23 42 / 0.08)",
        lg: "0 20px 50px rgb(15 23 42 / 0.16)",
        brand: "0 8px 22px rgb(108 60 139 / 0.32)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(135deg, #7e5399 0%, #6c3c8b 50%, #46275a 100%)",
        // Dải màu của logo, đúng hướng: đậm → sáng
        "gradient-accent": "linear-gradient(135deg, #c86e3a 0%, #f8ac3f 100%)",
        "gradient-hero":
          "linear-gradient(0deg, rgb(11 18 32 / 0.9) 0%, rgb(11 18 32 / 0.5) 40%, rgb(11 18 32 / 0) 78%)",
        "gradient-glow":
          "radial-gradient(ellipse at 30% 0%, rgb(248 172 63 / 0.10) 0%, rgb(108 60 139 / 0.06) 35%, rgb(108 60 139 / 0) 65%)",
      },
      // Kích thước khung layout (dùng: h-header, w-sidebar, pb-player…)
      spacing: {
        header: "64px",
        topnav: "52px",
        sidebar: "232px",
        "sidebar-mini": "76px",
        tabbar: "62px",
        player: "68px",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
```

Điểm chính:

- **`content`**: Tailwind quét các file này để biết class nào được dùng, chỉ sinh CSS cho các
  class đó. Class ghép chuỗi động (`"bg-" + mau`) sẽ **không** được thấy; luôn viết nguyên tên class.
- **`DEFAULT`**: `bg-brand` = `bg-brand-600`.
- **`screens`**: mockup viết desktop-first (`@media (max-width: 767px)` = "màn hình **nhỏ hơn**").
  Tailwind mobile-first: class không tiền tố áp cho **mọi** màn hình, `md:` áp cho màn **từ 768px trở lên**.
  Mốc của mockup (767/1024/1280/1536) trùng với Tailwind, chỉ thêm `xs: 400px`.

  ```text
  Mockup:   .grid { 3 cột }   @media (max-width: 767px) { .grid { 2 cột } }
  Tailwind: grid-cols-2 md:grid-cols-3
  ```

- **`fontFamily.sans`** dùng biến CSS `--font-sans` do `next/font` sinh (bước 5).

### Bước 4: `frontend/src/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    /* Chặn iOS tự phóng to chữ khi xoay ngang */
    -webkit-text-size-adjust: 100%;
  }

  body {
    @apply bg-bg font-sans text-ink antialiased;
  }

  /* Viền focus rõ ràng cho người dùng bàn phím; chuột bấm thì không hiện */
  :focus-visible {
    @apply outline-none ring-2 ring-brand-500 ring-offset-2 ring-offset-bg;
  }
}
```

- **`@tailwind base/components/utilities`**: chỗ Tailwind chèn CSS sinh ra.
- **`:focus-visible`**: viền tím khi dùng **bàn phím** (Tab) để di chuyển; bấm chuột thì không
  hiện. Đừng bao giờ `outline: none` mà không có thay thế: người không dùng chuột sẽ mất dấu đang ở đâu.

### Bước 5: `frontend/src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import "./globals.css";

// next/font tải font lúc build và tự host cùng site: trình duyệt không phải gọi sang
// Google Fonts (nhanh hơn, không lộ IP khách cho bên thứ ba), và không bị nháy font.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans", // tailwind.config.ts: fontFamily.sans dùng biến này
});

export const metadata: Metadata = {
  // Gốc để Next.js dựng URL tuyệt đối cho ảnh Open Graph
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Airlife – Đời sống hàng không",
    template: "%s | Airlife", // trang con: "Xem | Airlife"
  },
  description:
    "Mạng xã hội trên không cho khách bay và doanh nghiệp: phim, nhạc, mua sắm, vé bay, tour và tiện ích chuyến bay.",
  applicationName: "Airlife",
};

export const viewport: Viewport = {
  themeColor: "#6c3c8b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>{children}</body>
    </html>
  );
}
```

- **`Be_Vietnam_Pro` từ `next/font/google`**: Next tải font **lúc build**, lưu cùng site. Khách
  mở trang không phải gọi sang `fonts.googleapis.com`: nhanh hơn, và không gửi IP khách cho bên thứ ba.
- **`subsets: ["latin", "vietnamese"]`**: thiếu `vietnamese` là các chữ `ặ ỗ ữ` rơi về font
  hệ thống, trông lệch hẳn so với chữ khác.
- **`display: "swap"`**: font chưa tải xong thì hiện chữ bằng font hệ thống trước, không để trang trắng.
- **`lang="vi"`**: trình đọc màn hình đọc bằng giọng tiếng Việt; Chrome không hỏi "Dịch trang này?".
- **`metadata.title.template`**: trang con đặt `title: "Xem"` sẽ ra `Xem | Airlife`.
- **`metadataBase`**: Next cần URL gốc để dựng link tuyệt đối cho ảnh Open Graph.

### Bước 6: Trang tạm `frontend/src/app/page.tsx`

Trang này chỉ để nhìn theme: logo, font tiếng Việt, các màu, nút. Bài layout sẽ thay.

```tsx
// Trang tạm: kiểm tra logo, font và theme Tailwind. Bài layout sẽ thay bằng trang chủ thật.
const swatches = [
  { name: "brand-600", className: "bg-brand-600 text-white" },
  { name: "brand-300", className: "bg-brand-300 text-ink" },
  { name: "accent-700", className: "bg-accent-700 text-white" },
  { name: "accent-light", className: "bg-accent-light text-ink" },
  { name: "surface-2", className: "bg-surface-2 text-ink" },
  { name: "overlay", className: "bg-overlay text-white" },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu ảnh */}
      <img
        src="/brand/airlife-logo.svg"
        alt="Airlife – Đời sống hàng không"
        className="h-24 w-auto"
      />

      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Đời sống hàng không</h1>
        <p className="text-ink-muted">
          Font Be Vietnam Pro: ă â đ ê ô ơ ư — Ấ Ầ Ẩ Ẫ Ậ — Phở Hà Nội, Đà Lạt, Huế.
        </p>
        <p className="text-lg font-semibold text-accent-700">1.590.000₫</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {swatches.map((s) => (
          <div
            key={s.name}
            className={`rounded-card p-4 text-sm font-medium shadow-sm ${s.className}`}
          >
            {s.name}
          </div>
        ))}
        <div className="col-span-2 rounded-card bg-gradient-accent p-4 text-sm font-medium text-white sm:col-span-3">
          gradient-accent
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button className="rounded-card-sm bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-brand transition hover:bg-brand-700">
          Xem ngay
        </button>
        <button className="rounded-card-sm bg-accent-700 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-800">
          Mua ngay
        </button>
      </div>

      <div className="rounded-card bg-overlay p-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
        <img src="/brand/airlife-logo-white.svg" alt="Airlife" className="h-16 w-auto" />
      </div>
    </main>
  );
}
```

`eslint-disable-next-line @next/next/no-img-element -- lý do`: Next khuyên dùng `<Image>` để tối ưu
ảnh, nhưng SVG tĩnh không cần tối ưu. Tắt luật **đúng dòng đó** và ghi lý do.

## Kiểm tra

```bash
make fe-format      # Prettier sắp xếp lại class Tailwind, xuống dòng cho đúng
make fe-lint && make fe-typecheck
```

Mở http://localhost:3000:

- Logo Airlife đầy đủ ở trên, logo trắng trong khung tối ở dưới.
- Dòng chữ "ă â đ ê ô ơ ư — Ấ Ầ Ẩ Ẫ Ậ" cùng một font, không chữ nào lệch.
- Giá `1.590.000₫` màu cam đậm (`accent-700`).
- Nút "Xem ngay" có bóng tím (`shadow-brand`).
- Thu nhỏ cửa sổ dưới 640px: lưới màu từ 3 cột thành 2 cột.

DevTools (F12) → tab Network → lọc "font": file font tải từ `localhost:3000/_next/static/media/...`,
không phải từ Google.

```bash
git add . && git commit -m "Theme Tailwind Airlife, font Be Vietnam Pro"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Class `bg-brand-600` không có tác dụng | File không nằm trong `content` của `tailwind.config.ts`, hoặc tên class ghép động |
| Sửa `tailwind.config.ts` mà màu không đổi | Khởi động lại frontend: `make restart s=frontend` |
| Chữ có dấu (ặ, ỗ) trông khác chữ thường | Thiếu `"vietnamese"` trong `subsets` |
| `make up` báo lỗi tải font khi build | Container không ra được internet (proxy công ty). `next/font/google` cần mạng lúc build |
