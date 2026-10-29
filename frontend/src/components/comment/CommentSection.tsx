"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LoadMore } from "@/components/ui/LoadMore";
import { cn } from "@/lib/cn";
import { type CommentTarget, commentsOptions } from "@/lib/queries";

import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";

// Khung bình luận dưới video / bài viết. Lấy hoàn toàn ở trình duyệt (có cookie): mỗi người thấy
// khác nhau (đã thích chưa, bình luận nào của mình), và bình luận không cần cho SEO.
// Sắp xếp để trong useState, không đưa lên URL: không ai cần chia sẻ link "bình luận sắp theo Mới".
export function CommentSection({ target }: { target: CommentTarget }) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    commentsOptions(target, sort),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="binh-luan" className="mt-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="binh-luan" className="text-lg font-bold">
          Bình luận
        </h2>
        <div
          role="group"
          aria-label="Sắp xếp"
          className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold"
        >
          {(["top", "new"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={cn(
                "rounded-full px-3 py-1",
                sort === s
                  ? "bg-surface text-brand-700 shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {s === "top" ? "Hay" : "Mới"}
            </button>
          ))}
        </div>
      </div>

      <CommentComposer target={target} />

      {isPending ? (
        <p className="text-sm text-ink-muted">Đang tải bình luận…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">Chưa có bình luận. Hãy là người đầu tiên!</p>
      ) : (
        <ul className="grid gap-5">
          {items.map((c) => (
            <CommentItem key={c.id} comment={c} target={target} />
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </section>
  );
}
