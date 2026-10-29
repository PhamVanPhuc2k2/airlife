import Link from "next/link";

import { qs } from "@/lib/api";
import { cn } from "@/lib/cn";

type Props = {
  basePath: string; // "/xem"
  filters: { slug: string; name: string }[];
  activeTag?: string;
  sort: "new" | "popular";
};

// Chip lọc và nút sắp xếp đều là LINK (?f=…&sort=…), không phải nút đổi state:
// - Dán link cho người khác là họ thấy đúng bộ lọc.
// - Bấm "quay lại" của trình duyệt là về bộ lọc trước.
// - Server đọc tham số URL, lấy sẵn dữ liệu đúng bộ lọc.
export function FilterChips({ basePath, filters, activeTag, sort }: Props) {
  const href = (tag?: string, s: string = sort) => {
    const q = qs({ f: tag, sort: s === "popular" ? "popular" : undefined });
    return q ? `${basePath}?${q}` : basePath;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
      active ? "bg-gradient-brand text-white" : "bg-surface-2 text-ink-2 hover:bg-surface-3",
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav
        aria-label="Lọc"
        className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
      >
        <Link
          href={href(undefined)}
          className={chip(!activeTag)}
          aria-current={!activeTag ? "page" : undefined}
        >
          Tất cả
        </Link>
        {filters.map((f) => (
          <Link
            key={f.slug}
            href={href(f.slug)}
            className={chip(activeTag === f.slug)}
            aria-current={activeTag === f.slug ? "page" : undefined}
          >
            {f.name}
          </Link>
        ))}
      </nav>
      <div className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold">
        {(["new", "popular"] as const).map((s) => (
          <Link
            key={s}
            href={href(activeTag, s)}
            aria-current={sort === s ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5",
              sort === s ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {s === "new" ? "Mới nhất" : "Xem nhiều"}
          </Link>
        ))}
      </div>
    </div>
  );
}
