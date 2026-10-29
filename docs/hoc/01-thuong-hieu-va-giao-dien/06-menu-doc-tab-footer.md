# Bài 1.06: Menu dọc ba dạng, thanh tab, footer

> [← Bài trước](05-header-va-menu-ngang.md) · [Mục lục](../README.md) · [Bài sau →](07-mini-player.md)

## Mục tiêu

Menu dọc chạy đúng như mockup ở mọi cỡ màn hình, thanh tab dưới đáy trên điện thoại, footer nền tối.

## Bạn sẽ học

- Tách một thứ "đổi hình dạng theo trạng thái" thành **nhiều component cố định**, đơn giản hơn nhiều.
- **Radix Dialog**: ngăn kéo có sẵn khoá focus, phím Esc, trả focus về nút ☰.
- npm 11 chặn script lúc cài gói, và vì sao nên giữ chặn.

## Viết code

### Bước 1: Menu dọc của mockup làm gì

| Màn hình | Mặc định | Bấm ☰ |
|---|---|---|
| < 768px | Ẩn, thay bằng thanh tab dưới đáy | Mở ngăn kéo đầy đủ đè lên trang |
| 768–1279px | Thanh icon hẹp 76px | Mở ngăn kéo đầy đủ đè lên trang |
| ≥ 1280px | Menu đầy đủ 232px | Thu gọn thành thanh icon 76px |

Mockup làm bằng một `<aside>` duy nhất cộng CSS đổi kiểu theo class `body.sidebar-mini`,
`body.sidebar-open` và 3 mốc màn hình: rất nhiều tổ hợp. YouTube thì làm khác: **thanh icon** và
**menu đầy đủ** là hai thành phần riêng. Ta làm theo YouTube, chia ba component, mỗi cái một giao
diện cố định, chỉ còn câu hỏi "hiện hay ẩn":

| Component | Hiện khi |
|---|---|
| `SidebarRail` (76px) | `md:flex xl:hidden` + ≥ xl mà đang thu gọn |
| `SidebarDocked` (232px) | `xl:block` + không thu gọn |
| `SidebarDrawer` (232px, đè lên) | < xl và `drawerOpen` |

### Bước 2: Cài Radix Dialog

```bash
make npm c="install --save-exact @radix-ui/react-dialog@1.3.1"
```

npm 11 in cảnh báo:

```text
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
  unrs-resolver@1.12.2 (postinstall: node postinstall.js)
```

Từ npm 11, gói muốn chạy script lúc cài (`postinstall`) phải được **cho phép rõ ràng**. Đây là
lớp chặn tấn công chuỗi cung ứng: gói bị chiếm quyền thường cài mã độc qua chính script này.
`unrs-resolver` là gói phụ của ESLint; script của nó chỉ kiểm tra bản biên dịch sẵn, ESLint vẫn chạy
tốt khi không có. Nên **chặn hẳn**:

```bash
make npm c="install-scripts deny unrs-resolver"
```

npm ghi vào `package.json`:

```json
"allowScripts": { "unrs-resolver": false }
```

Quy tắc: gói nào xin chạy script thì đọc script đó làm gì, chỉ `approve` khi thật cần.

### Bước 3: `frontend/src/components/layout/Sidebar.tsx`

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/icons/Icon";
import { SIDENAV, TOPNAV, isActive } from "@/config/nav";
import { SITE } from "@/config/site";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";

// Menu dọc có ba dạng, giống YouTube. Tách thành ba component riêng thay vì một component
// đổi kiểu theo trạng thái: mỗi dạng có giao diện cố định, chỉ cần quyết định hiện/ẩn.
//
//   SidebarRail   thanh icon hẹp 76px     md…xl luôn hiện; ≥ xl hiện khi người dùng thu gọn
//   SidebarDocked menu đầy đủ 232px      ≥ xl, khi không thu gọn
//   SidebarDrawer menu đầy đủ dạng ngăn kéo, đè lên nội dung   < xl, khi bấm ☰

const asideBase = "fixed bottom-0 left-0 top-header z-[90] overflow-y-auto bg-bg";

export function SidebarRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Menu chính"
      className={cn(
        asideBase,
        "hidden w-sidebar-mini flex-col gap-1 px-1 pt-1.5 md:flex xl:hidden xl:group-data-[collapsed=true]/app:flex",
      )}
    >
      {SIDENAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[72px] flex-col items-center justify-center gap-[5px] rounded-card-sm px-0.5 text-center text-[11px] transition-colors hover:bg-surface",
              active ? "font-bold text-brand-700" : "font-medium text-ink-2",
            )}
          >
            <span
              className={cn(
                "flex h-[30px] w-[46px] items-center justify-center rounded-full",
                active && "bg-brand-600/15 text-brand-600",
              )}
            >
              <Icon name={item.icon} className="size-[22px]" />
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarDocked() {
  return (
    <aside
      aria-label="Menu chính"
      className={cn(
        asideBase,
        "hidden w-sidebar px-3 pb-6 pt-2.5 [scrollbar-width:thin] xl:block xl:group-data-[collapsed=true]/app:hidden",
      )}
    >
      <FullNav />
    </aside>
  );
}

// Radix Dialog lo phần khó của ngăn kéo: giữ focus bên trong khi đang mở, Esc để đóng, bấm
// ra ngoài để đóng, trả focus về nút ☰ khi đóng, và báo cho trình đọc màn hình biết.
export function SidebarDrawer() {
  const open = useUIStore((s) => s.drawerOpen);
  const setOpen = useUIStore((s) => s.setDrawerOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-x-0 bottom-0 top-header z-[98] bg-overlay/60 xl:hidden" />
        <Dialog.Content
          className={cn(asideBase, "z-[99] w-sidebar px-3 pb-6 pt-2.5 shadow-lg xl:hidden")}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          {/* Bấm vào một mục là chuyển trang, đóng ngăn kéo luôn */}
          <FullNav onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FullNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <NavGroup>
        {SIDENAV.map((item) => (
          <FullNavItem
            key={item.key}
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </NavGroup>

      {/* Mockup có "Kênh đang theo dõi": cần đăng nhập, làm ở phần Kênh (Phần 04) */}
      <NavGroup title="Kênh đang theo dõi">
        <Link
          href="/dang-nhap"
          onClick={onNavigate}
          className="flex h-11 items-center gap-4 rounded-card-sm px-3 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="login" />
          Đăng nhập để xem
        </Link>
      </NavGroup>

      <NavGroup title="Chuyên mục">
        {TOPNAV.map((item) => (
          <FullNavItem
            key={item.key}
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </NavGroup>

      <NavGroup>
        <FullNavItem
          item={{ label: "Liên hệ", href: "/lien-he", icon: "phone" }}
          active={isActive(pathname, "/lien-he")}
          onNavigate={onNavigate}
        />
      </NavGroup>

      <p className="px-3 pt-4 text-xs text-ink-dim">
        © {new Date().getFullYear()} {SITE.name}
        <br />
        {SITE.slogan}
      </p>
    </>
  );
}

function NavGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-ink/[0.07] py-2 last-of-type:border-b-0">
      {title && (
        <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-600">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function FullNavItem({
  item,
  active,
  onNavigate,
}: {
  item: { label: string; href: string; icon: IconName };
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-11 items-center gap-4 rounded-card-sm px-3 transition-colors",
        active
          ? // Nền nhạt dần sang phải + vạch màu bên trái, như mockup
            "bg-gradient-to-r from-brand-600/15 to-brand-600/[0.04] font-bold text-brand-700 before:absolute before:-left-3 before:bottom-2.5 before:top-2.5 before:w-[3px] before:rounded-r before:bg-gradient-brand"
          : "font-medium text-ink-2 hover:bg-surface hover:text-ink",
      )}
    >
      <Icon name={item.icon} className={cn("size-[22px]", active && "text-brand-600")} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
```

Điểm chính:

- **`Dialog.Root open={open} onOpenChange={setOpen}`**: Radix điều khiển theo state của ta. Esc
  hoặc bấm ra ngoài thì Radix gọi `onOpenChange(false)`.
- **`Dialog.Portal`**: ngăn kéo được gắn vào cuối `<body>`, không bị khung cha cắt hay đè.
- **`Dialog.Title className="sr-only"`**: hộp thoại bắt buộc có tiêu đề cho trình đọc màn hình;
  `sr-only` ẩn với mắt nhưng vẫn đọc được. `aria-describedby={undefined}` báo Radix là không có mô tả.
- **`onNavigate`**: bấm một mục trong ngăn kéo là đóng ngăn kéo. Truyền hàm xuống thay vì dùng
  `useEffect` theo dõi đường dẫn: đơn giản và không vẽ lại thừa.
- **`before:` cho vạch màu**: mục đang mở có vạch gradient bên trái, vẽ bằng pseudo-element
  `::before` (`before:absolute before:-left-3 ...`), như `&::before` của mockup.
- **"Kênh đang theo dõi"** cần đăng nhập; tạm hiện link "Đăng nhập để xem", làm thật ở Phần 04.

### Bước 4: `frontend/src/components/layout/TabBar.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { SIDENAV, isActive } from "@/config/nav";
import { cn } from "@/lib/cn";

// Thanh tab dưới cùng trên điện thoại (kiểu app): 5 mục đầu của menu dọc.
// pb-[env(safe-area-inset-bottom)]: chừa chỗ cho thanh vuốt Home trên iPhone đời mới.
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Menu nhanh"
      className="fixed inset-x-0 bottom-0 z-[96] grid h-tabbar grid-cols-5 border-t border-brand-500/20 bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      {SIDENAV.slice(0, 5).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "grid content-center justify-items-center gap-[3px] text-[11px]",
              active ? "font-bold text-brand-700" : "font-medium text-ink-muted",
            )}
          >
            <Icon name={item.icon} className="size-[22px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`env(safe-area-inset-bottom)`: iPhone không có nút Home có thanh vuốt ở đáy màn hình. Chừa chỗ để
các tab không nằm đè lên thanh vuốt.

### Bước 5: `frontend/src/components/layout/Footer.tsx`

```tsx
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { SIDENAV, TOPNAV } from "@/config/nav";
import { SITE } from "@/config/site";

export function Footer() {
  return (
    <footer className="mt-6 border-t border-brand-500/35 bg-overlay px-6 pb-5 pt-11 text-sm text-white/65">
      <div className="mx-auto grid max-w-[1680px] gap-8 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr]">
        <div>
          <Link href="/" aria-label="Airlife – Trang chủ" className="inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu */}
            <img src="/brand/airlife-logo-white.svg" alt="Airlife" className="h-12 w-auto" />
          </Link>
          <p className="mt-3.5 max-w-[300px]">{SITE.tagline}.</p>
        </div>

        <FooterCol title="Chuyên mục">
          {TOPNAV.map((t) => (
            <FooterLink key={t.key} href={t.href}>
              {t.label}
            </FooterLink>
          ))}
        </FooterCol>

        <FooterCol title="Giải trí">
          {SIDENAV.slice(1, 4).map((t) => (
            <FooterLink key={t.key} href={t.href}>
              {t.label}
            </FooterLink>
          ))}
          <FooterLink href="/dang-ban">Mở gian hàng</FooterLink>
        </FooterCol>

        <FooterCol title="Liên hệ">
          <p className="flex gap-2.5">
            <Icon name="map" className="mt-px size-[18px] text-brand-300" />
            {SITE.address}
          </p>
          <a href={SITE.phoneHref} className="flex gap-2.5 hover:text-brand-200">
            <Icon name="phone" className="mt-px size-[18px] text-brand-300" />
            {SITE.phone}
          </a>
          <a href={`mailto:${SITE.email}`} className="flex gap-2.5 hover:text-brand-200">
            <Icon name="mail" className="mt-px size-[18px] text-brand-300" />
            {SITE.email}
          </a>
        </FooterCol>
      </div>

      <div className="mx-auto mt-8 max-w-[1680px] border-t border-white/10 pt-4 text-xs tracking-[0.06em] text-white/40">
        © {new Date().getFullYear()} AIRLIFE. All rights reserved.
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-brand-300">{title}</h2>
      {children}
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hover:text-brand-200">
      {children}
    </Link>
  );
}
```

- Footer **không** có `"use client"`: không có tương tác. Nhưng vì được import trong `AppShell` (một
  client component, bài 1.08), nó vẫn chạy cùng phía client. Không sao với component nhỏ thế này.
- Tiêu đề cột dùng `<h2>`: cấu trúc tiêu đề đúng giúp trình đọc màn hình nhảy giữa các phần.
- `lg:grid-cols-[1.4fr_1fr_1fr_1.6fr]`: đúng tỉ lệ cột của mockup; dấu `_` thay cho dấu cách trong
  giá trị tuỳ ý của Tailwind.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-format && make fe-audit
```

```bash
git add . && git commit -m "Menu dọc, thanh tab, footer"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Console báo `DialogContent requires a DialogTitle` | Thiếu `Dialog.Title`. Muốn ẩn thì dùng `className="sr-only"`, không xoá |
| Ngăn kéo mở mà nền phía sau vẫn cuộn | Radix tự khoá cuộn; nếu vẫn cuộn, kiểm tra có đang dùng đúng `Dialog.Content` không |
| Cả thanh icon lẫn menu đầy đủ cùng hiện ở màn ≥ 1280px | Thiếu `xl:hidden` ở `SidebarRail` hoặc sai tên nhóm `/app` |
