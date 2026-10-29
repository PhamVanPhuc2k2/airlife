# Bài 1.04: Icon và cấu hình menu

> [← Bài trước](03-theme-tailwind-va-font.md) · [Mục lục](../README.md) · [Bài sau →](05-header-va-menu-ngang.md)

## Mục tiêu

Có nền cho layout: component `<Icon>` dùng chung, danh sách mục của hai menu và thông tin site
nằm trong file cấu hình. Bài 1.05–1.08 dựng các phần của layout trên nền này.

## Bạn sẽ học

- Mockup vẽ HTML bằng chuỗi (`'<a href="' + ... + '">'`); React dựng bằng component. Dữ liệu
  menu tách ra file riêng, giao diện chỉ việc `.map()`.
- Hai loại icon: **icon nét** (stroke, vẽ bằng đường viền) và **icon tô đặc** (fill) của bộ
  thiết kế Player.
- TypeScript: `satisfies` và `keyof typeof` để tên icon gõ sai là báo lỗi ngay khi viết code.

## Viết code

### Bước 1: Bản đồ layout

Layout mockup (`skyline/js/layout.js`) gồm 7 phần, mỗi phần thành một component:

```text
┌──────────────────────────── Header (☰, logo, tìm kiếm, nút) ──────────────────────────┐
├──────────┬──────────────── TopNav (chuyên mục, xổ tiểu mục) ──────────────────────────┤
│ Sidebar  │                                                                             │
│ (menu    │                         nội dung trang                                      │
│  dọc)    │                                                                             │
│          ├──────────────────────────── Footer ─────────────────────────────────────────┤
│          ├──────────────────────────── MiniPlayer ─────────────────────────────────────┤
└──────────┴──────────── TabBar (chỉ trên điện thoại) ───────────────────────────────────┘
```

```bash
mkdir -p frontend/src/{components/icons,components/layout,components/player,components/dev,config,lib,stores}
```

### Bước 2: `frontend/src/lib/cn.ts`

```ts
// Ghép class Tailwind, bỏ qua giá trị rỗng/false: cn("a", ok && "b", undefined) → "a b".
// Đủ dùng cho dự án; không cần thư viện clsx.
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
```

Dùng để thêm class theo điều kiện: `cn("px-3", active && "font-bold")`.

### Bước 3: Bộ icon

#### `frontend/src/components/icons/player-icons.ts`

Các icon Home, Xem (màn hình), Nghe (âm thanh), phát, dừng, tua 10 giây và chiếc máy bay đầu thanh
Player do designer vẽ (`skyline/_thiet-ke/Player.pdf`). Mockup đã tách chúng thành `js/icons.js`;
file này là cùng dữ liệu đó viết lại thành TypeScript. File sinh tự động nên **chép, không gõ**:

```bash
lay frontend/src/components/icons/player-icons.ts
```

Mở file ra xem cấu trúc: mỗi icon có `viewBox` và danh sách `paths`. Cuối file:

```ts
export const PLAYER_ICONS = { home: {...}, rewind: {...}, ... } satisfies Record<string, PlayerIconData>;
export type PlayerIconName = keyof typeof PLAYER_ICONS;
```

- **`satisfies`**: kiểm tra object đúng kiểu `Record<string, PlayerIconData>`, nhưng **giữ nguyên**
  tên từng khoá. Nếu viết `: Record<string, PlayerIconData>` thì TypeScript chỉ biết "khoá là string",
  mất danh sách tên.
- **`keyof typeof PLAYER_ICONS`**: kiểu là `"home" | "rewind" | "forward" | ...`. Viết
  `<Icon name="hoem" />` là TypeScript báo lỗi.

#### `frontend/src/components/icons/Icon.tsx`

```tsx
import type { ReactElement } from "react";

import { cn } from "@/lib/cn";

import { PLAYER_ICONS, type PlayerIconName } from "./player-icons";

// Icon nét 24×24 (vẽ bằng stroke), lấy từ mockup Skyline (js/layout.js, ICON_PATHS).
// Dùng cho những chỗ bộ thiết kế Player chưa có icon: tìm kiếm, giỏ hàng, chuông…
const LINE_ICONS = {
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12h12L22 7H6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
      <path d="m9 11 5 3-5 3z" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 19 5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  news: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v10H10l-4 4v-4H4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  store: (
    <>
      <path d="M4 9h16l-1-5H5z" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1" />
  ),
  map: (
    <>
      <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  caret: <path d="m7 10 5 5 5-5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  login: <path d="M10 4H6v16h4M14 8l4 4-4 4M18 12H7" />,
} satisfies Record<string, ReactElement>;

type LineIconName = keyof typeof LINE_ICONS;
export type IconName = LineIconName | PlayerIconName;

type IconProps = {
  name: IconName;
  className?: string;
};

// Mặc định size-5 (20px); đổi cỡ bằng className, vd. "size-6".
// aria-hidden: icon chỉ để trang trí, nút chứa icon phải tự có aria-label.
export function Icon({ name, className }: IconProps) {
  if (name in PLAYER_ICONS) {
    const icon = PLAYER_ICONS[name as PlayerIconName];
    return (
      <svg
        viewBox={icon.viewBox}
        aria-hidden="true"
        className={cn("size-5 shrink-0 fill-current", className)}
      >
        {icon.paths.map((p, i) => (
          // Danh sách tĩnh, không đổi thứ tự: dùng index làm key là an toàn
          <path key={i} d={p.d} fillRule={p.evenOdd ? "evenodd" : "nonzero"} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      {LINE_ICONS[name as LineIconName]}
    </svg>
  );
}
```

- Icon nét lấy từ `ICON_PATHS` của mockup, đổi chuỗi SVG thành JSX: `stroke-width` → `strokeWidth`,
  `class` → `className`.
- `fill-current` / `stroke="currentColor"`: icon lấy màu chữ của phần tử cha. Đổi màu icon bằng
  `text-brand-600`, không cần prop màu riêng.
- `aria-hidden="true"`: icon chỉ trang trí. Nút chỉ có icon phải tự có `aria-label`.

### Bước 4: `frontend/src/config/nav.ts`

```ts
import type { IconName } from "@/components/icons/Icon";

// Hai menu của mockup (skyline/js/layout.js: SIDENAV, TOPNAV), đổi đường dẫn .html sang route
// Next.js theo bảng ở TASKS.md mục 3.5. Header, menu dọc, menu ngang, thanh tab và footer
// đều đọc từ đây: thêm/bớt mục chỉ sửa một chỗ.

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: IconName;
};

export type TopNavItem = NavItem & {
  subs: { label: string; href: string; desc: string }[];
};

// Menu dọc (kiểu YouTube). 5 mục đầu cũng là thanh tab dưới cùng trên điện thoại.
export const SIDENAV: NavItem[] = [
  { key: "home", label: "Home", href: "/", icon: "home" },
  { key: "xem", label: "Xem", href: "/xem", icon: "screen" },
  { key: "nghe", label: "Nghe", href: "/nghe", icon: "sound" },
  { key: "moi-tai", label: "Mới tải", href: "/moi-tai", icon: "sparkle" },
  { key: "ban", label: "Bạn", href: "/ban", icon: "user" },
  { key: "suu-tap", label: "Sưu tập", href: "/suu-tap", icon: "library" },
];

// Menu ngang: chuyên mục, rê chuột (hoặc Tab tới) thì xổ tiểu mục.
export const TOPNAV: TopNavItem[] = [
  {
    key: "tien-ich",
    label: "Tiện ích",
    href: "/tien-ich",
    icon: "radar",
    subs: [
      { label: "Ra tàu bay", href: "/tien-ich/ra-tau-bay", desc: "Check-in, giờ lên tàu, hành lý" },
      {
        label: "Flightradar",
        href: "/tien-ich/flightradar",
        desc: "Theo dõi chuyến bay trực tiếp",
      },
      { label: "Thời tiết điểm đến", href: "/tien-ich/thoi-tiet", desc: "Dự báo tại sân bay đến" },
      { label: "Wi-Fi trên máy bay", href: "/tien-ich/wifi", desc: "Gói kết nối theo chặng bay" },
      {
        label: "Phòng chờ & fast-track",
        href: "/tien-ich/phong-cho",
        desc: "Đặt trước dịch vụ sân bay",
      },
    ],
  },
  {
    key: "tin-tuc",
    label: "Tin tức",
    href: "/tin-tuc",
    icon: "news",
    subs: [
      { label: "Khám phá", href: "/tin-tuc?f=kham-pha", desc: "Điểm đến, sân bay, văn hóa" },
      { label: "Sự kiện", href: "/tin-tuc?f=su-kien", desc: "Tin hoạt động Airlife" },
      { label: "Mẹo bay", href: "/tin-tuc?f=meo-bay", desc: "Bay thông minh, thoải mái" },
      { label: "Line-up phim", href: "/tin-tuc?f=line-up-phim", desc: "Phim mới trên chuyến bay" },
    ],
  },
  {
    key: "kinh-doanh",
    label: "Kinh doanh",
    href: "/kinh-doanh",
    icon: "briefcase",
    subs: [
      { label: "Vé bay", href: "/kinh-doanh?f=ve-bay", desc: "Giá tốt cho chặng tiếp theo" },
      { label: "Miễn thuế", href: "/kinh-doanh?f=mien-thue", desc: "Nhận tại cửa ra máy bay" },
      { label: "Mua sắm", href: "/kinh-doanh?f=mua-sam", desc: "Đồ du lịch, quà tặng" },
      { label: "Đặc sản", href: "/kinh-doanh?f=dac-san", desc: "Quà vùng miền chính gốc" },
      {
        label: "Dịch vụ sân bay",
        href: "/kinh-doanh?f=dich-vu-san-bay",
        desc: "Phòng chờ, fast-track, đưa đón",
      },
    ],
  },
  {
    key: "y-kien",
    label: "Ý kiến",
    href: "/y-kien",
    icon: "chat",
    subs: [
      { label: "Trải nghiệm", href: "/y-kien/trai-nghiem", desc: "Chia sẻ chuyến bay của bạn" },
      { label: "Khảo sát", href: "/y-kien/khao-sat", desc: "Bình chọn, xem kết quả" },
      { label: "Góp ý", href: "/y-kien/gop-y", desc: "Gửi phản hồi cho Airlife" },
    ],
  },
  {
    key: "tour-bay",
    label: "Tour bay",
    href: "/tour-bay",
    icon: "globe",
    subs: [
      { label: "Trong nước", href: "/tour-bay?f=trong-nuoc", desc: "Phú Quốc, Đà Lạt, Phong Nha…" },
      { label: "Quốc tế", href: "/tour-bay?f=quoc-te", desc: "Nhật Bản, Hàn Quốc…" },
      {
        label: "Combo bay + khách sạn",
        href: "/tour-bay?f=combo",
        desc: "Trọn gói, tự do lịch trình",
      },
    ],
  },
];

// Mục có đang mở không, theo đường dẫn hiện tại. "/" chỉ khớp đúng trang chủ;
// mục khác khớp cả trang con: /xem/abc vẫn sáng mục "Xem".
export function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0] ?? href;
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}
```

- Đường dẫn đổi theo bảng route ở TASKS.md mục 3.5: `chuyen-muc.html?c=xem` → `/xem`,
  `tien-ich.html?tab=wifi` → `/tien-ich/wifi`.
- **`isActive`**: mockup phải tự đọc `data-page` và tham số URL để biết mục nào đang mở. Next.js có
  `usePathname()`, chỉ cần so đường dẫn. `/xem/abc` (trang xem một video) vẫn sáng mục "Xem".

### Bước 5: `frontend/src/config/site.ts`

```ts
// Thông tin chung của site, dùng ở footer, trang liên hệ, metadata.
// Địa chỉ, điện thoại, email đang giữ theo site cũ skyline.vn: CHỜ KHÁCH XÁC NHẬN
// thông tin pháp nhân và email của Airlife (TASKS.md: "Câu hỏi cần chốt với khách").
export const SITE = {
  name: "Airlife",
  slogan: "Đời sống hàng không",
  tagline: "Mạng xã hội trên không cho khách bay và doanh nghiệp",
  address: "Tầng 7, 53 Phó Đức Chính, Phường Nguyễn Thái Bình, Quận 1, TP. Hồ Chí Minh, Việt Nam",
  phone: "(+84) 28 3933 3249",
  phoneHref: "tel:+842839333249",
  email: "content@skyline.vn",
} as const;
```

Địa chỉ và email đang giữ theo site cũ, có ghi chú **chờ khách xác nhận**. Không tự bịa email
`@airlife.vn` khi chưa biết khách dùng domain nào.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

Thử gõ sai tên icon trong `nav.ts` (`icon: "hoem"`), chạy `make fe-typecheck`: phải báo lỗi
`Type '"hoem"' is not assignable to type 'IconName'`. Sửa lại.

```bash
git add . && git commit -m "Icon và cấu hình menu"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Icon không hiện, chỉ là ô trống | Icon nét thiếu `fill="none"` thì bị tô đen kín; icon tô đặc thiếu `fill-current` thì không có màu |
| `Cannot find module '@/lib/cn'` | Thiếu `paths` trong `tsconfig.json` (bài 1.02) |
