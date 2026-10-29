"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";

import { MediaCard } from "@/components/media/MediaCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { api } from "@/lib/api";
import { useInvalidateLibrary } from "@/lib/library";
import { libraryListOptions } from "@/lib/queries";

import { RemoveButton } from "./RemoveButton";

const TEXT = {
  history: {
    empty: "Bạn chưa xem nội dung nào. Nội dung bạn xem sẽ hiện ở đây.",
    remove: "Xoá khỏi lịch sử",
  },
  saved: {
    empty: "Chưa có nội dung đã lưu. Bấm “Lưu” ở trang xem để lưu lại xem sau.",
    remove: "Bỏ lưu",
  },
};

// Lưới "Đã xem" (list = history, có vạch tiến độ) hoặc "Đã lưu" (list = saved) ở Sưu tập.
export function LibraryGrid({ list }: { list: "history" | "saved" }) {
  const invalidate = useInvalidateLibrary();
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    libraryListOptions(list),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const remove = useMutation({
    mutationFn: (slug: string) => api<void>(`/me/${list}/${slug}`, { method: "DELETE" }),
    onSettled: (_d, _e, slug) => invalidate(slug),
  });
  const clear = useMutation({
    mutationFn: () => api<void>("/me/history", { method: "DELETE" }),
    onSettled: () => invalidate(),
  });

  if (isPending) {
    return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  }
  if (items.length === 0) {
    return <p className="py-16 text-center text-ink-muted">{TEXT[list].empty}</p>;
  }

  return (
    <>
      {list === "history" && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Xoá toàn bộ lịch sử xem?")) clear.mutate();
            }}
            disabled={clear.isPending}
            className="text-sm font-semibold text-ink-muted hover:text-danger"
          >
            Xoá toàn bộ lịch sử
          </button>
        </div>
      )}
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m) => (
          <MediaCard
            key={m.id}
            media={m}
            progress={m.progress}
            action={
              <RemoveButton
                label={TEXT[list].remove}
                disabled={remove.isPending}
                onClick={() => remove.mutate(m.slug)}
              />
            }
          />
        ))}
      </div>
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </>
  );
}
