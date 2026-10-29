"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { CHANNEL_TYPE_LABEL } from "@/components/channel/labels";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber } from "@/lib/format";
import type { ChannelBrief } from "@/lib/types";

// Lưới kênh đang theo dõi ở trang Bạn. Cùng key với danh sách ở menu dọc (Sidebar), nên chỉ
// gọi API một lần cho cả hai, và cùng được làm mới khi bấm Theo dõi.
export function FollowingChannels() {
  const { data, isPending } = useQuery({
    queryKey: ["me", "following"],
    queryFn: () => api<ChannelBrief[]>("/me/following"),
  });
  if (isPending) return null;

  return (
    <section aria-labelledby="kenh-theo-doi-title" id="kenh-theo-doi" className="scroll-mt-24">
      <h2 id="kenh-theo-doi-title" className="mb-4 text-xl font-bold">
        Kênh đang theo dõi
      </h2>
      {data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/kenh/${c.slug}`}
                className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07] transition hover:ring-brand-300"
              >
                <Avatar name={c.name} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-semibold">
                    <span className="truncate">{c.name}</span>
                    {c.verified && <Icon name="check" className="size-4 shrink-0 text-brand-600" />}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">
                    {CHANNEL_TYPE_LABEL[c.type]} · {compactNumber(c.followers_count)} theo dõi
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface p-6 text-center text-ink-muted">
          Bạn chưa theo dõi kênh nào. Bấm “Theo dõi” ở trang kênh hoặc trang xem để thấy kênh ở đây.
        </p>
      )}
    </section>
  );
}
