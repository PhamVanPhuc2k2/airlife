import Link from "next/link";

import { ChipLinks } from "@/components/ui/ChipLinks";
import { qs } from "@/lib/api";
import { cn } from "@/lib/cn";

type Props = {
  basePath: string; // "/xem"
  filters: { slug: string; name: string }[];
  activeTag?: string;
  // Các cách sắp xếp; cách đầu tiên là mặc định (không ghi lên URL)
  sorts: readonly { value: string; label: string }[];
  sort: string;
};

// Chip lọc và nút sắp xếp đều là LINK (?f=…&sort=…), không phải nút đổi state:
// - Dán link cho người khác là họ thấy đúng bộ lọc.
// - Bấm "quay lại" của trình duyệt là về bộ lọc trước.
// - Server đọc tham số URL, lấy sẵn dữ liệu đúng bộ lọc.
export function FilterChips({ basePath, filters, activeTag, sorts, sort }: Props) {
  const href = (tag?: string, s: string = sort) => {
    const q = qs({ f: tag, sort: s === sorts[0]?.value ? undefined : s });
    return q ? `${basePath}?${q}` : basePath;
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ChipLinks
        items={[
          { href: href(undefined), label: "Tất cả", active: !activeTag },
          ...filters.map((f) => ({
            href: href(f.slug),
            label: f.name,
            active: activeTag === f.slug,
          })),
        ]}
      />
      <div className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold">
        {sorts.map((s) => (
          <Link
            key={s.value}
            href={href(activeTag, s.value)}
            aria-current={sort === s.value ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5",
              sort === s.value
                ? "bg-surface text-brand-700 shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
