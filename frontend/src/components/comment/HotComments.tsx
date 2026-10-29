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
