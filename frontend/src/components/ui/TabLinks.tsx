import Link from "next/link";

import { cn } from "@/lib/cn";

import type { ChipLink } from "./ChipLinks";

// Thanh tab gạch chân (mockup: .tabs). Mỗi tab là một link ?tab=… để dán link là mở đúng tab.
export function TabLinks({ items, label }: { items: ChipLink[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="-mx-3 flex gap-6 overflow-x-auto border-b border-ink/[0.07] px-3 [scrollbar-width:none] md:mx-0 md:px-0"
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "relative shrink-0 py-3 font-semibold transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full",
            t.active
              ? "text-brand-700 after:bg-gradient-brand"
              : "text-ink-muted after:bg-transparent hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
