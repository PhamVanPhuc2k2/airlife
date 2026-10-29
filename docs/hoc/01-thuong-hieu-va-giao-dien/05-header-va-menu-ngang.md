# Bài 1.05: Header và menu ngang

> [← Bài trước](04-icon-va-cau-hinh-menu.md) · [Mục lục](../README.md) · [Bài sau →](06-menu-doc-tab-footer.md)

## Mục tiêu

`Header` (nút ☰, logo, ô tìm kiếm, các nút bên phải) và `TopNav` (chuyên mục dạng chip, xổ tiểu
mục khi rê chuột hoặc dùng bàn phím). Store Zustand đầu tiên cho nút ☰.

## Bạn sẽ học

- **Zustand**: state dùng chung giữa các component không cha-con với nhau.
- Component **client** (`"use client"`) khác component server thế nào, khi nào cần.
- Menu xổ xuống **chỉ bằng CSS**: `group-hover` / `group-focus-within` của Tailwind.
- Tailwind mobile-first: `hidden md:flex` = ẩn trên điện thoại, hiện từ 768px.

## Viết code

### Bước 1: Cài Zustand và store giao diện

```bash
make npm c="install --save-exact zustand@5.0.16"
```

Nút ☰ nằm trong `Header`, còn menu dọc là component khác (bài 1.06). Hai thứ không lồng nhau, nên
không truyền props qua lại được. Zustand tạo một **store** ngoài cây component; ai cần thì đọc.

#### `frontend/src/stores/ui-store.ts`

```ts
import { create } from "zustand";

// Trạng thái giao diện dùng chung giữa Header (nút ☰) và menu dọc.
//
// Nút ☰ làm hai việc khác nhau tuỳ độ rộng màn hình (giống YouTube):
//   ≥ 1280px: thu gọn / mở rộng menu dọc tại chỗ (navCollapsed)
//   < 1280px: mở / đóng menu dạng ngăn kéo đè lên nội dung (drawerOpen)
type UIState = {
  navCollapsed: boolean;
  drawerOpen: boolean;
  toggleNav: () => void;
  setDrawerOpen: (open: boolean) => void;
};

// Cùng mốc với `xl` trong tailwind.config.ts
const DESKTOP_QUERY = "(min-width: 1280px)";

export const useUIStore = create<UIState>()((set) => ({
  navCollapsed: false,
  drawerOpen: false,
  toggleNav: () => {
    // Chỉ chạy khi người dùng bấm nút, lúc đó chắc chắn đang ở trình duyệt (có window).
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      set((s) => ({ navCollapsed: !s.navCollapsed }));
    } else {
      set((s) => ({ drawerOpen: !s.drawerOpen }));
    }
  },
  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));
```

- `create<UIState>()((set) => ({...}))`: khai báo state và các hàm đổi state trong cùng một chỗ.
- Component đọc bằng **selector**: `useUIStore((s) => s.toggleNav)`. Component chỉ vẽ lại khi giá
  trị nó chọn thay đổi, không vẽ lại khi phần khác của store đổi.
- `window.matchMedia(...)`: hỏi trình duyệt màn hình đang rộng bao nhiêu. Chỉ gọi trong hàm xử lý
  click; nếu gọi lúc render, server (không có `window`) sẽ báo lỗi.

### Bước 2: Class `.icon-btn` dùng chung

Nút tròn chỉ có icon xuất hiện rất nhiều lần (☰, chuông, giỏ hàng…). Thay vì chép chuỗi class dài,
khai báo một class trong `@layer components` của `frontend/src/app/globals.css`, gõ thêm vào cuối file:

```css
@layer components {
  /* Nút tròn chỉ có icon (☰, chuông, giỏ hàng…). Nút phải có aria-label vì không có chữ. */
  .icon-btn {
    @apply relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink;
  }
}
```

(Bài 1.07 thêm tiếp CSS của thanh Player vào cùng khối `@layer components` này.)

### Bước 3: `frontend/src/components/layout/Header.tsx`

```tsx
"use client";

import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { useUIStore } from "@/stores/ui-store";

export function Header() {
  const toggleNav = useUIStore((s) => s.toggleNav);

  return (
    <header className="fixed inset-x-0 top-0 z-[100] flex h-header items-center justify-between gap-2 bg-bg/90 px-2 backdrop-blur-md md:gap-4 md:px-4">
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className="icon-btn" aria-label="Mở menu" onClick={toggleNav}>
          <Icon name="menu" className="size-[22px]" />
        </button>
        <Link href="/" aria-label="Airlife – Trang chủ" className="ml-1 flex items-center">
          {/* Wordmark (không slogan): ở cỡ 32px slogan quá nhỏ, không đọc được */}
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu */}
          <img src="/brand/airlife-wordmark.svg" alt="Airlife" className="h-7 w-auto md:h-8" />
        </Link>
      </div>

      {/* Form GET thường: chạy được cả khi JavaScript chưa tải xong */}
      <form
        action="/tim-kiem"
        role="search"
        className="hidden h-[42px] max-w-[620px] flex-1 overflow-hidden rounded-full bg-surface shadow-[inset_0_0_0_1px_rgb(15_23_42/0.14)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_theme(colors.brand.500),0_0_0_4px_rgb(108_60_139/0.12)] md:flex"
      >
        <input
          type="search"
          name="q"
          placeholder="Tìm phim, podcast, vé bay, tour, kênh…"
          aria-label="Tìm kiếm"
          className="min-w-0 flex-1 bg-transparent px-5 outline-none placeholder:text-ink-dim focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <button
          type="submit"
          aria-label="Tìm"
          className="flex w-[60px] items-center justify-center bg-surface-2 text-ink-2 hover:text-brand-700"
        >
          <Icon name="search" />
        </button>
      </form>

      <div className="flex shrink-0 items-center gap-1">
        <Link href="/tim-kiem" className="icon-btn md:hidden" aria-label="Tìm kiếm">
          <Icon name="search" className="size-[22px]" />
        </Link>
        <Link
          href="/dang-ban"
          className="mr-1 hidden h-10 items-center gap-2 rounded-full px-3 font-semibold text-brand-700 transition-colors hover:bg-brand-50 md:inline-flex"
        >
          <Icon name="upload" />
          {/* Màn hẹp hơn 1280px chỉ còn icon, giống mockup */}
          <span className="hidden xl:inline">Đăng bán</span>
        </Link>
        <LangSwitch />
        <button type="button" className="icon-btn" aria-label="Thông báo">
          <Icon name="bell" className="size-[22px]" />
        </button>
        <Link href="/gio-hang" className="icon-btn" aria-label="Giỏ hàng">
          <Icon name="cart" className="size-[22px]" />
        </Link>
        <Link href="/dang-nhap" className="icon-btn" aria-label="Đăng nhập">
          <Icon name="user" className="size-[22px]" />
        </Link>
      </div>
    </header>
  );
}

// Chuyển ngôn ngữ như site cũ skyline.vn. Tiếng Anh làm ở bước i18n (TASKS.md 3.1),
// hiện chỉ hiển thị để giữ đúng bố cục.
function LangSwitch() {
  return (
    <div className="hidden rounded-full bg-surface-2 p-[3px] text-xs font-bold lg:flex">
      <span className="rounded-full bg-gradient-brand px-2.5 py-1 text-white" aria-current="true">
        VN
      </span>
      <span
        className="cursor-not-allowed rounded-full px-2.5 py-1 text-ink-muted"
        title="Tiếng Anh: sắp có"
        aria-disabled="true"
      >
        EN
      </span>
    </div>
  );
}
```

- **`"use client"`**: Next.js mặc định render component trên **server** (gửi HTML, không gửi
  JavaScript). Component có `onClick`, dùng hook (`useUIStore`, `usePathname`) phải chạy trên trình
  duyệt, nên đánh dấu `"use client"` ở dòng đầu.
- **Form tìm kiếm là `<form action="/tim-kiem">` thường**: bấm Enter là chuyển tới `/tim-kiem?q=...`,
  chạy được cả khi JavaScript chưa tải xong.
- **`hidden md:flex`**: ô tìm kiếm ẩn trên điện thoại (thay bằng nút kính lúp `md:hidden`), giống mockup.
- **`bg-bg/90 backdrop-blur-md`**: nền hơi trong và làm mờ nội dung cuộn phía sau, như mockup.
- Ô nhập có `focus-visible:ring-0`: viền focus chung (bài 1.03) bị tắt cho riêng ô này, vì cả form
  đã đổi viền khi focus (`focus-within:shadow-[...]`).

### Bước 4: `frontend/src/components/layout/TopNav.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { TOPNAV, isActive } from "@/config/nav";
import { cn } from "@/lib/cn";

// Menu ngang: chuyên mục dạng chip (kiểu YouTube).
//
// Tiểu mục xổ xuống bằng CSS thuần (group-hover / group-focus-within), không cần JavaScript:
// rê chuột vào, hoặc Tab tới link chuyên mục, là menu hiện. Tab tiếp sẽ đi vào các tiểu mục
// vì focus vẫn nằm trong cùng một nhóm.
//
// Trên điện thoại (< 768px): thanh chip vuốt ngang, không xổ tiểu mục (tiểu mục hiện thành
// chip lọc ngay trong trang chuyên mục).
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Chuyên mục"
      className="fixed left-0 right-0 top-header z-[95] h-topnav border-b border-ink/[0.07] bg-bg/90 backdrop-blur-md transition-[left] duration-300 ease-brand md:left-sidebar-mini md:px-4 xl:left-sidebar xl:group-data-[collapsed=true]/app:left-sidebar-mini"
    >
      <ul className="flex h-full items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] md:overflow-visible md:px-0">
        {TOPNAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key} className="group/item relative flex h-full shrink-0 items-center">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-full px-[13px] text-[13px] font-semibold transition-colors md:h-9 md:px-3.5 md:text-sm",
                  active
                    ? "bg-gradient-brand text-white"
                    : "bg-surface-2 text-ink-2 group-focus-within/item:bg-surface-3 group-focus-within/item:text-ink group-hover/item:bg-surface-3 group-hover/item:text-ink",
                )}
              >
                <Icon
                  name={item.icon}
                  className={cn("size-[18px]", active ? "text-white" : "text-brand-600")}
                />
                {item.label}
                <Icon
                  name="caret"
                  className={cn(
                    "-mr-1 hidden size-4 transition-transform group-focus-within/item:rotate-180 group-hover/item:rotate-180 md:block",
                    active ? "text-white" : "text-ink-muted",
                  )}
                />
              </Link>

              <div className="invisible absolute left-0 top-[calc(100%-4px)] hidden min-w-[260px] translate-y-1.5 rounded-[14px] bg-surface p-2 opacity-0 shadow-lg ring-1 ring-ink/[0.14] transition duration-200 ease-brand group-focus-within/item:visible group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100 group-hover/item:visible group-hover/item:translate-y-0 group-hover/item:opacity-100 md:block">
                {item.subs.map((sub) => (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    className="group/sub grid gap-px rounded-[10px] px-3 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <strong className="text-sm font-semibold group-hover/sub:text-brand-700">
                      {sub.label}
                    </strong>
                    <small className="text-xs text-ink-muted">{sub.desc}</small>
                  </Link>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

**Menu xổ bằng CSS**: mỗi `<li>` là một nhóm có tên `group/item`. Khung tiểu mục mặc định
`invisible opacity-0`; khi chuột ở trong nhóm (`group-hover/item:`) hoặc focus ở trong nhóm
(`group-focus-within/item:`) thì thành `visible opacity-100`. Không cần `useState`, không cần
JavaScript. Người dùng bàn phím nhấn Tab tới "Kinh doanh" là menu mở, Tab tiếp đi vào từng tiểu mục.

Đặt tên nhóm (`/item`, `/sub`) vì có nhiều nhóm lồng nhau: `group-hover/sub:` chỉ phản ứng với
nhóm `/sub`, không bị nhóm ngoài làm sáng cùng lúc.

**`md:overflow-visible`**: trên điện thoại thanh chip cuộn ngang (`overflow-x-auto`). Từ 768px phải
để `overflow-visible`, nếu không khung tiểu mục bị cắt mất vì nằm ngoài chiều cao thanh.

**`xl:group-data-[collapsed=true]/app:left-sidebar-mini`**: menu ngang dịch sang trái khi menu dọc
thu gọn. Thuộc tính `data-collapsed` nằm ở thẻ bọc ngoài cùng (bài 1.08 viết).

## Kiểm tra

Chưa thấy trên trang: bài 1.08 mới ghép các phần vào layout. Kiểm tra code:

```bash
make fe-typecheck && make fe-lint && make fe-format
```

```bash
git add . && git commit -m "Header, menu ngang, store giao diện"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `You're importing a component that needs useState... mark it with "use client"` | Thiếu `"use client"` ở dòng đầu file dùng hook |
| `window is not defined` | Gọi `window` lúc render. Chỉ dùng trong hàm xử lý sự kiện hoặc `useEffect` |
| Rê chuột vào thì menu xổ, nhưng di chuột xuống menu thì nó biến mất | Có khe hở giữa chip và khung tiểu mục. `top-[calc(100%-4px)]` để khung chồng lên 4px, chuột đi qua không rời nhóm |
| Mọi tiểu mục cùng sáng khi rê vào một mục | Dùng `group-hover:` không tên; phải là `group-hover/sub:` |
