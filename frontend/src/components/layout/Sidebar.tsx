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
