# Bài 5.08: Bình luận nổi bật ở trang chủ, kênh đang theo dõi ở menu; nghiệm thu Phần 05

> [← Bài trước](07-frontend-binh-luan.md) · [Mục lục](../README.md) · [Phần 06 →](../06-ban-va-suu-tap/01-schema-thu-vien.md)

## Mục tiêu

- Cột "Bình luận nổi bật" (tab Hay/Nhiều) bên phải khối nổi bật ở trang chủ, như bản vẽ tay của mockup.
- Khối "Nghe nhiều" chuyển xuống hàng dưới.
- Menu dọc liệt kê kênh đang theo dõi.

## Bạn sẽ học

- Đặt một client component nhỏ trong trang server component.
- Giới hạn chiều cao và cuộn bên trong một cột lưới.
- Hai component dùng chung một key truy vấn để đồng bộ (`["me", "following"]`).

## Viết code

### Bước 1: `frontend/src/components/comment/HotComments.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { mediaHref } from "@/components/media/links";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { compactNumber, timeAgo } from "@/lib/format";
import type { HotComment } from "@/lib/types";

// Cột "Bình luận nổi bật" ở trang chủ, hai tab theo bản vẽ mockup: Hay (nhiều thích) / Nhiều
// (nhiều trả lời). Dữ liệu cả hai tab đến sẵn từ /home; đổi tab chỉ đổi danh sách hiển thị.
export function HotComments({ top, replied }: { top: HotComment[]; replied: HotComment[] }) {
  const [tab, setTab] = useState<"top" | "replied">("top");
  const items = tab === "top" ? top : replied;

  return (
    <section className="flex h-full flex-col rounded-card bg-surface p-[18px] shadow-sm ring-1 ring-ink/[0.07]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 whitespace-nowrap text-lg font-bold">
          <Icon name="fire" className="text-accent-600" />
          Bình luận nổi bật
        </h2>
        <div
          role="group"
          aria-label="Sắp xếp"
          className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold"
        >
          {(["top", "replied"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                "rounded-full px-3 py-1",
                tab === t ? "bg-gradient-brand text-white" : "text-ink-muted",
              )}
            >
              {t === "top" ? "Hay" : "Nhiều"}
            </button>
          ))}
        </div>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Chưa có bình luận.</p>
      ) : (
        // grid-cols-1 = minmax(0, 1fr): cột không tự giãn theo dòng chữ dài nhất (không có thì nội
        // dung tràn ngang, bị cắt mép phải)
        <ul className="grid grid-cols-1 gap-4 overflow-y-auto overscroll-contain pr-1">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex gap-3 border-b border-ink/[0.07] pb-4 last:border-0 last:pb-0"
            >
              <Avatar name={c.author.display_name} size="sm" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <strong className="text-sm">{c.author.display_name}</strong>
                  <time
                    dateTime={c.created_at}
                    className="text-xs text-ink-muted"
                    suppressHydrationWarning
                  >
                    {timeAgo(c.created_at)}
                  </time>
                </p>
                <p className="mt-0.5 line-clamp-3 text-sm">{c.body}</p>
                <Link
                  href={mediaHref(c.media)}
                  className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700"
                >
                  <Icon name="comment" className="size-3.5" />
                  <span className="truncate">{c.media.title}</span>
                </Link>
                <p className="mt-1.5 flex gap-4 text-xs text-ink-muted">
                  <span>{compactNumber(c.like_count)} thích</span>
                  <span>{c.reply_count} trả lời</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- **Dữ liệu hai tab đến sẵn từ `/home`**: đổi tab không gọi API, chỉ đổi danh sách hiển thị. Đây là
  client component chỉ vì có `useState`.
- **`grid-cols-1` trên `ul`**: bản đầu thiếu dòng này; lưới ngầm định co theo nội dung, câu bình luận dài
  đẩy rộng cột, tràn ra ngoài khung.
- **`overflow-y-auto overscroll-contain`**: cuộn bên trong cột; cuộn tới cuối không kéo cả trang theo.
- **`whitespace-nowrap` cho tiêu đề**: cột hẹp (màn 1280px) làm "Bình luận nổi bật" xuống 3 dòng; giữ một
  dòng và cho cụm tab xuống hàng (`flex-wrap`).

### Bước 2: Trang chủ, `frontend/src/app/page.tsx`

```tsx
import { HotComments } from "@/components/comment/HotComments";
import { FeaturedHero } from "@/components/media/FeaturedHero";
import { MediaCard } from "@/components/media/MediaCard";
import { MediaTile } from "@/components/media/MediaTile";
import { RankList } from "@/components/media/RankList";
import { Panel } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import type { Home } from "@/lib/types";

// Trang lấy dữ liệu từ API lúc có request, không dựng sẵn lúc build (lúc build không có API
// để gọi). Dữ liệu đã được backend cache 60 giây bằng Redis.
export const dynamic = "force-dynamic";

// Server component: lấy dữ liệu ngay trên server, gửi về HTML có sẵn nội dung (tốt cho SEO,
// hiện nhanh). Chỉ cột Bình luận nổi bật (đổi tab Hay/Nhiều) là client component.
export default async function HomePage() {
  const home = await api<Home>("/home");

  return (
    <div className="mx-auto max-w-[1680px] space-y-8 px-3 py-4 md:px-6 md:py-6">
      {/* Bố cục theo bản vẽ tay của mockup: 3 ô | khối nổi bật | bình luận nổi bật */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)_minmax(280px,1fr)]">
        <div className="lg:order-2">{home.featured && <FeaturedHero media={home.featured} />}</div>

        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 [scrollbar-width:none] lg:order-1 lg:mx-0 lg:grid lg:grid-rows-3 lg:overflow-visible lg:px-0">
          {home.latest.map((m) => (
            <div key={m.id} className="w-[72%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
              <MediaTile media={m} />
            </div>
          ))}
        </div>

        {/* Màn ≥ 1280px: cao bằng khối nổi bật, cuộn bên trong */}
        <div className="lg:order-3 lg:col-span-2 xl:col-span-1 xl:max-h-[560px]">
          <HotComments top={home.hot_comments.top} replied={home.hot_comments.replied} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Đang được xem nhiều</h2>
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
          {home.trending.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      </section>

      {/* Hàng dưới của mockup: Nghe nhiều | Kinh doanh (Phần 07) | Tiện ích (Phần 10) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Nghe nhiều" icon="sound" moreHref="/nghe?sort=popular">
          <RankList items={home.top_listen} />
        </Panel>
      </section>
    </div>
  );
}
```

`xl:max-h-[560px]`: ở màn ≥ 1280px cột cao bằng khối nổi bật, phần còn lại cuộn bên trong. Màn nhỏ hơn thì
cột xuống dưới, cao tự nhiên.

### Bước 3: Kênh đang theo dõi, `frontend/src/components/layout/Sidebar.tsx`

Thay đoạn "Bạn chưa theo dõi kênh nào." cố định bằng `FollowingList`. Bản đầy đủ:

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { SIDENAV, TOPNAV, isActive } from "@/config/nav";
import { SITE } from "@/config/site";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { ChannelBrief } from "@/lib/types";
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

      <NavGroup title="Kênh đang theo dõi">
        {me ? (
          <FollowingList onNavigate={onNavigate} />
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

// Kênh đang theo dõi (GET /me/following). Nút Theo dõi làm mới danh sách này (FollowButton).
function FollowingList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data = [], isPending } = useQuery({
    queryKey: ["me", "following"],
    queryFn: () => api<ChannelBrief[]>("/me/following"),
  });
  if (isPending) return null;
  if (data.length === 0) {
    return <p className="px-3 py-2 text-sm text-ink-muted">Bạn chưa theo dõi kênh nào.</p>;
  }
  return (
    <>
      {data.map((c) => {
        const href = `/kenh/${c.slug}`;
        const active = isActive(pathname, href);
        return (
          <Link
            key={c.slug}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3.5 rounded-card-sm px-3 text-sm transition-colors",
              active
                ? "bg-brand-600/10 font-bold text-brand-700"
                : "font-medium text-ink-2 hover:bg-surface hover:text-ink",
            )}
          >
            <Avatar name={c.name} size="xs" />
            <span className="truncate">{c.name}</span>
          </Link>
        );
      })}
    </>
  );
}
```

- **Key `["me", "following"]`** trùng với key mà `FollowButton` làm mới (`onSettled`, bài 5.06): bấm Theo
  dõi ở trang kênh là menu dọc cập nhật ngay, hai component không cần biết nhau.
- **Chỉ hiện khi `me` có** (đã đăng nhập), nên không gọi `/me/following` cho khách (sẽ bị `401`).

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
```

Nghiệm thu Phần 05 trên trình duyệt (http://localhost:3000):

| Làm gì | Thấy gì |
|---|---|
| Trang chủ, màn rộng | 3 ô | khối nổi bật | Bình luận nổi bật; cột cuộn bên trong, không tràn |
| Bấm tab "Nhiều" | Danh sách xếp theo số trả lời |
| Bấm một bình luận nổi bật | Sang trang xem video được bình luận |
| Thu hẹp cửa sổ dưới 1280px | Cột bình luận xuống dưới, tiêu đề vẫn một dòng |
| Đăng nhập, theo dõi kênh "Bay Vui Travel" | Menu dọc, mục "Kênh đang theo dõi" có Bay Vui Travel |
| Bỏ theo dõi | Kênh biến mất khỏi menu, còn "Bạn chưa theo dõi kênh nào." |
| Đăng xuất | Mục đó thành link "Đăng nhập để xem" |

```bash
git add . && git commit -m "Frontend kênh, bình luận, bình luận nổi bật"
```

Đến đây xong Phần 05. Tiếp theo: [Phần 06 →](../06-ban-va-suu-tap/01-schema-thu-vien.md)

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Câu bình luận dài làm cột tràn ra ngoài | Thiếu `grid-cols-1` (hoặc `min-w-0`) trên lưới chứa danh sách |
| Tiêu đề "Bình luận nổi bật" xuống 3 dòng | Thêm `whitespace-nowrap` cho `h2`, `flex-wrap` cho header |
| Theo dõi xong menu dọc không đổi | Key ở `Sidebar` khác key mà `FollowButton` làm mới |
| Trang chủ chưa có bình luận mới viết | Cache `/home` 60 giây (bài 5.04) |
