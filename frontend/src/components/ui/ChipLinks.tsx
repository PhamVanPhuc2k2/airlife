import Link from "next/link";

import { cn } from "@/lib/cn";

export type ChipLink = { href: string; label: string; active: boolean };

// Hàng chip lọc dạng LINK (bộ lọc nằm trên URL, xem bài 2.11). Điện thoại: vuốt ngang.
export function ChipLinks({ items, label = "Lọc" }: { items: ChipLink[]; label?: string }) {
  return (
    <nav
      aria-label={label}
      className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
    >
      {items.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          aria-current={c.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
            c.active
              ? "bg-gradient-brand text-white"
              : "bg-surface-2 text-ink-2 hover:bg-surface-3",
          )}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
