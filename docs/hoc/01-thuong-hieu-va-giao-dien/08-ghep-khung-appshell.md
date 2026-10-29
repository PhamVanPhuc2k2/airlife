# Bài 1.08: Ghép khung `AppShell`, trang 404, nghiệm thu layout

> [← Bài trước](07-mini-player.md) · [Mục lục](../README.md) · [Phần 02 →](../02-noi-dung-xem-nghe/01-schema-noi-dung.md)

## Mục tiêu

Mọi trang có chung header, hai menu, footer, thanh tab và mini player. Đường dẫn chưa có trang hiện
trang 404 ngay trong khung. Kiểm tra toàn bộ layout ở 3 cỡ màn hình.

## Bạn sẽ học

- **Layout gốc** của Next.js App Router: bọc mọi trang, không bị dựng lại khi chuyển trang.
- Truyền trạng thái xuống bằng **thuộc tính `data-*` + `group-data-[...]`** của Tailwind, thay vì
  truyền props qua từng tầng.
- Link "Bỏ qua menu" cho người dùng bàn phím.

## Viết code

### Bước 1: `frontend/src/components/layout/AppShell.tsx`

```tsx
"use client";

import { usePlayerStore } from "@/stores/player-store";
import { useUIStore } from "@/stores/ui-store";

import { Footer } from "./Footer";
import { Header } from "./Header";
import { MiniPlayer } from "./MiniPlayer";
import { SidebarDrawer, SidebarDocked, SidebarRail } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TopNav } from "./TopNav";

// Khung chung của mọi trang (thay js/layout.js của mockup).
//
// Thẻ bọc ngoài cùng mang hai thuộc tính data-*:
//   data-collapsed: người dùng thu gọn menu dọc (chỉ có tác dụng ở màn ≥ 1280px)
//   data-playing:   đang có mini player → chừa chỗ dưới đáy để nội dung không bị che
// Các phần con dùng biến thể Tailwind `group-data-[...]/app:` để đổi vị trí theo hai thuộc tính
// này, nên chỉ AppShell cần đọc store, các phần con vẫn là component tĩnh.
//
// Độ rộng menu dọc theo màn hình (Tailwind mobile-first):
//   < 768px  (mặc định): không có menu dọc, dùng thanh tab dưới đáy; ☰ mở ngăn kéo
//   768–1279 (md):       thanh icon hẹp 76px; ☰ mở ngăn kéo đầy đủ đè lên nội dung
//   ≥ 1280   (xl):       menu đầy đủ 232px; ☰ thu gọn thành thanh icon 76px
export function AppShell({ children }: { children: React.ReactNode }) {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const hasPlayer = usePlayerStore((s) => s.current !== null);

  return (
    <div className="group/app" data-collapsed={navCollapsed} data-playing={hasPlayer}>
      {/* Người dùng bàn phím/trình đọc màn hình bỏ qua menu, nhảy thẳng tới nội dung */}
      <a
        href="#noi-dung"
        className="sr-only z-[200] rounded-card-sm bg-brand-600 px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Bỏ qua menu
      </a>

      <Header />
      <TopNav />
      <SidebarRail />
      <SidebarDocked />
      <SidebarDrawer />

      <div
        className={
          // Chừa chỗ cho header + menu ngang ở trên, menu dọc bên trái, thanh tab/mini player ở dưới
          "flex min-h-screen flex-col bg-gradient-glow bg-no-repeat " +
          "pb-tabbar pt-[calc(theme(spacing.header)_+_theme(spacing.topnav))] " +
          "transition-[margin] duration-300 ease-brand " +
          "md:ml-sidebar-mini md:pb-0 xl:ml-sidebar xl:group-data-[collapsed=true]/app:ml-sidebar-mini " +
          "group-data-[playing=true]/app:pb-[calc(theme(spacing.tabbar)_+_theme(spacing.player))] " +
          "md:group-data-[playing=true]/app:pb-player"
        }
      >
        <main id="noi-dung" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>

      <MiniPlayer />
      <TabBar />
    </div>
  );
}
```

**Vì sao `data-collapsed` thay vì props**: menu ngang, nội dung, mini player đều phải dịch trái/phải
khi menu dọc thu gọn. Nếu truyền `collapsed` làm prop thì mọi component đó phải nhận prop và tự tính
class. Ở đây chỉ `AppShell` đọc store rồi gắn `data-collapsed="true"` lên thẻ ngoài cùng (đặt tên nhóm
`group/app`). Bên trong, class `xl:group-data-[collapsed=true]/app:ml-sidebar-mini` nghĩa là: "màn
≥ 1280px **và** tổ tiên `group/app` có `data-collapsed="true"` thì margin trái 76px". Tailwind sinh ra
CSS dạng:

```css
@media (min-width: 1280px) {
  .group\/app[data-collapsed="true"] .xl\:group-data-\[collapsed\=true\]\/app\:ml-sidebar-mini {
    margin-left: 76px;
  }
}
```

**`pt-[calc(theme(spacing.header)_+_theme(spacing.topnav))]`**: header (64px) và menu ngang (52px)
là `fixed`, không chiếm chỗ; nội dung phải chừa 116px phía trên. Trong `calc` bắt buộc có dấu cách
quanh `+`; trong class Tailwind viết dấu cách bằng `_`.

**Link "Bỏ qua menu"**: `sr-only` ẩn đi, `focus:not-sr-only` hiện ra khi được focus. Người dùng bàn
phím nhấn Tab lần đầu sẽ thấy nó; Enter là nhảy thẳng tới `<main id="noi-dung">`, không phải Tab
qua hơn 20 mục menu.

### Bước 2: Bọc layout gốc

Trong `frontend/src/app/layout.tsx`, import `AppShell` và bọc `children`. Bản đầy đủ:

```tsx
import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import { AppShell } from "@/components/layout/AppShell";

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
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

Layout gốc là **server component**; `AppShell` là client component. Server component được phép
render client component, và `children` (trang) vẫn là server component dù nằm trong `AppShell`.

### Bước 3: `frontend/src/app/not-found.tsx`

```tsx
import Link from "next/link";

// Trang 404, hiện bên trong khung chung (header, menu vẫn còn).
// Giai đoạn đầu, nhiều mục menu chưa có trang: khách bấm vào sẽ thấy trang này.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
      <img src="/brand/airlife-mark.svg" alt="" className="size-24 opacity-80" />
      <h1 className="mt-6 text-2xl font-bold">Không tìm thấy trang</h1>
      <p className="mt-2 text-ink-muted">
        Trang này không tồn tại hoặc đang được xây dựng. Bạn quay lại trang chủ nhé.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand transition hover:bg-brand-700"
      >
        Về trang chủ
      </Link>
    </div>
  );
}
```

Next.js tự dùng file này cho mọi đường dẫn không có trang, hiển thị **bên trong** layout gốc, và trả
mã HTTP **404** (công cụ tìm kiếm biết là trang không tồn tại, không lập chỉ mục).

## Kiểm tra

Mở http://localhost:3000 và thử lần lượt:

| Màn hình | Thao tác | Phải thấy |
|---|---|---|
| ≥ 1280px | Mở trang | Menu dọc đầy đủ, mục Home sáng, có vạch tím bên trái |
| ≥ 1280px | Bấm ☰ | Menu thu thành thanh icon 76px, menu ngang và nội dung dịch sang trái |
| ≥ 1280px | Rê chuột vào "Kinh doanh" | Xổ 5 tiểu mục, mũi tên xoay ngược |
| ≥ 1280px | Nhấn Tab từ đầu trang | Hiện link "Bỏ qua menu"; Tab tới chuyên mục thì menu xổ |
| 768–1279px (thu nhỏ cửa sổ) | Mở trang | Thanh icon 76px; "Đăng bán" chỉ còn icon |
| 768–1279px | Bấm ☰ | Ngăn kéo đầy đủ đè lên trang, nền tối; Esc hoặc bấm ra ngoài để đóng |
| < 768px (DevTools → chế độ điện thoại) | Mở trang | Không có menu dọc, có thanh tab 5 mục dưới đáy; chip chuyên mục vuốt ngang |
| Mọi cỡ | Bấm "Phát thử mini player" | Mini player hiện dưới đáy (điện thoại: nằm trên thanh tab); bấm dừng thì thanh đường băng đứng lại |
| Mọi cỡ | Bấm "Xem" trên menu | Trang 404 trong khung, mục "Xem" sáng |

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/xem      # 404
make fe-typecheck && make fe-lint && make fe-audit
```

```bash
git add . && git commit -m "AppShell: ghép layout chung"
```

Đến đây xong Phần 01: thương hiệu và khung giao diện Airlife.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Nội dung bị header che mất phần đầu | Thiếu `pt-[calc(...)]` hoặc thiếu dấu `_` quanh `+` (CSS `calc(64px+52px)` không hợp lệ) |
| Bấm ☰ ở màn rộng không thu gọn | Thẻ ngoài cùng thiếu `group/app` hoặc `data-collapsed` |
| Chuyển trang thì mini player biến mất | `AppShell` đặt trong `page.tsx` thay vì `layout.tsx`; trang bị dựng lại thì state mất |
| Console báo lỗi hydration | Component render khác nhau giữa server và trình duyệt (vd. dùng `window` lúc render) |
