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
