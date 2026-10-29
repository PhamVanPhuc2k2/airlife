import Image from "next/image";
import Link from "next/link";

import { compactNumber, durationLabel } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Danh sách xếp hạng có số thứ tự (khối "Nghe nhiều" của mockup).
export function RankList({ items }: { items: MediaCard[] }) {
  return (
    <ol className="grid gap-3">
      {items.map((m, i) => (
        <li key={m.id}>
          <Link href={mediaHref(m)} className="group flex items-center gap-3">
            <span className="w-6 shrink-0 text-center text-2xl font-bold text-brand-600">
              {i + 1}
            </span>
            <span className="relative size-[72px] shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
              <Image src={m.thumbnail_url} alt="" fill sizes="72px" className="object-cover" />
              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
                {durationLabel(m)}
              </span>
            </span>
            <span className="grid min-w-0">
              <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
                {m.title}
              </strong>
              <small className="truncate text-ink-muted">{m.channel.name}</small>
              <small className="text-ink-muted">
                {compactNumber(m.view_count)} {viewWord(m)}
              </small>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
