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
