# Bài 4.08: Menu tài khoản, trang Bạn, `proxy.ts`

> [← Bài trước](07-trang-dang-nhap-dang-ky.md) · [Mục lục](../README.md) · [Bài sau →](09-mailpit-va-hang-doi-job.md)

## Mục tiêu

Header hiện avatar và menu tài khoản khi đã đăng nhập; trang `/ban` có thẻ hồ sơ; `/ban`, `/suu-tap`
chuyển tới trang đăng nhập nếu chưa đăng nhập. Nghiệm thu toàn bộ phần đăng nhập trên trình duyệt.

## Bạn sẽ học

- Radix DropdownMenu và `asChild`.
- `proxy.ts` của Next.js 16 (trước đây là `middleware.ts`): lớp tiện lợi, không phải lớp bảo mật.
- Hiệu ứng phụ (chuyển trang) phải nằm trong `useEffect`.

## Viết code

### Bước 1: Cài Radix DropdownMenu

```bash
make npm c="install --save-exact @radix-ui/react-dropdown-menu@2.2.1"
```

Thêm icon đăng xuất vào `LINE_ICONS` (`frontend/src/components/icons/Icon.tsx`):

```tsx
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
```

### Bước 2: `frontend/src/components/layout/AccountMenu.tsx`

```tsx
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useLogout, useMe } from "@/lib/auth";

// Góc phải header: chưa đăng nhập → nút "Đăng nhập"; đã đăng nhập → avatar mở menu.
// Radix DropdownMenu lo bàn phím (mũi tên lên/xuống, Esc), focus, và nhãn cho trình đọc màn hình.
export function AccountMenu() {
  const { me, isLoading } = useMe();
  const logout = useLogout();
  const router = useRouter();
  const pathname = usePathname();

  if (isLoading) {
    // Đang hỏi /auth/me: giữ chỗ đúng cỡ để header không bị giật khi có kết quả
    return <span className="size-10" aria-hidden="true" />;
  }
  if (!me) {
    return (
      <Link
        href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
        className="icon-btn"
        aria-label="Đăng nhập"
      >
        <Icon name="user" className="size-[22px]" />
      </Link>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Tài khoản"
        className="ml-1 rounded-full transition hover:ring-2 hover:ring-brand-500 data-[state=open]:ring-2 data-[state=open]:ring-brand-500"
      >
        <Avatar name={me.display_name} size="sm" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-[110] min-w-[240px] rounded-[14px] bg-surface p-2 shadow-lg ring-1 ring-ink/[0.14]"
        >
          <div className="px-3 py-2">
            <p className="font-semibold">{me.display_name}</p>
            <p className="truncate text-sm text-ink-muted">{me.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-ink/[0.07]" />
          <MenuLink href="/ban" icon="user" label="Trang của bạn" />
          <MenuLink href="/suu-tap" icon="library" label="Sưu tập" />
          <DropdownMenu.Separator className="my-1 h-px bg-ink/[0.07]" />
          <DropdownMenu.Item
            onSelect={() =>
              logout.mutate(undefined, {
                onSettled: () => {
                  router.push("/");
                  router.refresh();
                },
              })
            }
            className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
          >
            <Icon name="logout" />
            Đăng xuất
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    // asChild: Radix gắn hành vi mục menu lên chính thẻ <Link>, không bọc thêm thẻ nào
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
      >
        <Icon name={icon} />
        {label}
      </Link>
    </DropdownMenu.Item>
  );
}
```

- **Đang tải thì giữ chỗ `size-10`**: header không nhảy khi biết kết quả.
- **`asChild`**: Radix gắn hành vi mục menu (bàn phím, focus) lên chính `<Link>`, không bọc thêm thẻ.
- **`data-[highlighted]:`**: Radix gắn `data-highlighted` cho mục đang chọn bằng chuột hoặc mũi tên.

Trong `frontend/src/components/layout/Header.tsx`, thay link "Đăng nhập" cuối header bằng `<AccountMenu />`
(và `import { AccountMenu } from "./AccountMenu";`).

### Bước 3: Menu dọc biết đã đăng nhập

Khối "Kênh đang theo dõi" trong `frontend/src/components/layout/Sidebar.tsx` hiện "Bạn chưa theo dõi kênh
nào." khi đã đăng nhập (danh sách thật ở Phần 05). Bản đầy đủ:

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/icons/Icon";
import { SIDENAV, TOPNAV, isActive } from "@/config/nav";
import { SITE } from "@/config/site";
import { useMe } from "@/lib/auth";
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
  const { me } = useMe();

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

      {/* Danh sách kênh đang theo dõi làm ở Phần 05 (Kênh) */}
      <NavGroup title="Kênh đang theo dõi">
        {me ? (
          <p className="px-3 py-2 text-sm text-ink-muted">Bạn chưa theo dõi kênh nào.</p>
        ) : (
          <Link
            href="/dang-nhap"
            onClick={onNavigate}
            className="flex h-11 items-center gap-4 rounded-card-sm px-3 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="login" />
            Đăng nhập để xem
          </Link>
        )}
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

### Bước 4: Trang Bạn

#### `frontend/src/components/account/ProfileCard.tsx`

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { useLogout, useMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  user: "Thành viên",
  creator: "Nhà sáng tạo",
  business: "Doanh nghiệp",
  editor: "Biên tập viên",
  admin: "Quản trị viên",
};

// Thẻ hồ sơ ở trang Bạn. Dữ liệu riêng của từng người nên lấy ở trình duyệt (useMe), không
// render sẵn trên server.
export function ProfileCard() {
  const { me, isLoading } = useMe();
  const logout = useLogout();
  const router = useRouter();

  // proxy.ts đã chặn khách chưa đăng nhập; tới đây mà không có me là phiên vừa hết hạn.
  // Chuyển trang là hiệu ứng phụ: đặt trong useEffect, không gọi ngay lúc render.
  const expired = !isLoading && !me;
  useEffect(() => {
    if (expired) router.replace("/dang-nhap?next=/ban");
  }, [expired, router]);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-card bg-surface-2" />;
  }
  if (!me) return null;

  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07] sm:flex-row sm:items-center">
      <Avatar name={me.display_name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">{me.display_name}</h1>
        <p className="text-ink-muted">{me.email}</p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700">
            {ROLE_LABEL[me.role] ?? me.role}
          </span>
          {!me.email_verified && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 font-semibold text-accent-800">
              Chưa xác minh email
            </span>
          )}
          <span className="text-ink-muted">Tham gia {formatDate(me.created_at)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => logout.mutate(undefined, { onSettled: () => router.replace("/") })}
        className="h-10 self-start rounded-full bg-surface-2 px-5 font-semibold text-ink-2 hover:bg-surface-3 sm:self-center"
      >
        Đăng xuất
      </button>
    </section>
  );
}
```

Bản đầu gọi `router.replace(...)` ngay trong thân component (lúc render). React không cho hiệu ứng phụ
khi đang render (render có thể chạy nhiều lần, hoặc bị bỏ dở); chuyển vào `useEffect`.

#### `frontend/src/app/ban/page.tsx`

```tsx
import type { Metadata } from "next";

import { ProfileCard } from "@/components/account/ProfileCard";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn. Mockup còn có: chuyến bay sắp tới, đơn hàng, tiếp tục xem, kênh theo dõi; các
// khối đó thêm dần ở các phần sau khi có dữ liệu.
export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <ProfileCard />
    </div>
  );
}
```

### Bước 5: `frontend/src/proxy.ts`

```ts
import { type NextRequest, NextResponse } from "next/server";

// proxy.ts (Next.js 16; trước đây là middleware.ts): chạy TRƯỚC khi dựng trang.
// Trang cần đăng nhập mà không có cookie al_session → chuyển tới trang đăng nhập, kèm ?next= để
// đăng nhập xong quay lại đúng trang.
//
// Đây chỉ là lớp tiện lợi cho người dùng, KHÔNG phải lớp bảo mật: cookie al_session ai cũng tự
// tạo được. Bảo mật thật nằm ở API (RequireAuth kiểm tra access token).
export function proxy(request: NextRequest) {
  if (request.cookies.has("al_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/dang-nhap";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

// Chỉ chạy cho các trang cần đăng nhập
export const config = {
  matcher: ["/ban/:path*", "/suu-tap/:path*"],
};
```

- Next.js 16 đổi tên `middleware.ts` thành `proxy.ts`, hàm `middleware` thành `proxy`. Có thể xác nhận
  trong `node_modules/next/dist/lib/constants.js` (`PROXY_FILENAME = 'proxy'`); Next 16 còn kèm sẵn tài
  liệu trong `node_modules/next/dist/docs`.
- **Không phải lớp bảo mật**: ai cũng tự tạo cookie `al_session=1` được. Họ vào được trang Bạn, nhưng
  `/auth/me` trả 401 vì không có access token thật. Dữ liệu chỉ được bảo vệ ở API.
- File mới như `proxy.ts` đôi khi phải khởi động lại `next dev` mới được nhận: `make restart s=frontend`.

## Kiểm tra

Nghiệm thu trên trình duyệt (cửa sổ ẩn danh cho sạch cookie):

| Thao tác | Phải thấy |
|---|---|
| Mở `/ban` khi chưa đăng nhập | Chuyển tới `/dang-nhap?next=%2Fban` |
| Đăng ký từ đó | Quay lại `/ban`: thẻ hồ sơ, "Thành viên", "Chưa xác minh email", ngày tham gia |
| Bấm avatar góc phải | Menu: tên, email, Trang của bạn, Sưu tập, Đăng xuất. Mũi tên lên/xuống chọn được, Esc để đóng |
| Menu dọc | "Kênh đang theo dõi: Bạn chưa theo dõi kênh nào." |
| Đăng xuất | Về trang chủ, góc phải là biểu tượng đăng nhập; DevTools → Application → Cookies: hết `al_*` |
| `/dang-nhap?next=/tin-tuc`, đăng nhập đúng | Về `/tin-tuc` |
| `/dang-nhap?next=https://trang-gia.com`, đăng nhập | Về `/` của Airlife, không ra trang lạ |

Tự làm mới khi access token hết hạn: tạm đặt `AUTH_ACCESS_TTL=1m` trong `backend/.env`,
`make restart s=api`, đăng nhập, đợi hơn 1 phút rồi **tải lại** `/ban`. Tab Network: `/auth/me 401` →
`/auth/refresh 200` → `/auth/me 200`, trang vẫn hiện hồ sơ. Trả về `15m` sau khi thử.

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
git add . && git commit -m "Menu tài khoản, trang Bạn, proxy"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Mở `/ban` không chuyển hướng | `next dev` chưa nhận `proxy.ts`: khởi động lại frontend; hoặc file đặt sai chỗ (phải ở `src/`, cạnh `app/`) |
| Tải lại `/ban` bị đá sang đăng nhập dù vẫn đăng nhập | Thiếu trạng thái "chưa biết" trong `useMe` (bài 4.06) |
| Menu tài khoản bị header che | `DropdownMenu.Content` thiếu `z-[110]` (header là `z-[100]`) |
