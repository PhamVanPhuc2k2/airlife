"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { MediaCard } from "@/components/media/MediaCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";

// Lưới media cuộn tải thêm (LoadMore). Trang đầu đã được server lấy sẵn (CategoryPage → prefetch),
// nên lần render đầu có dữ liệu ngay, không có màn "đang tải".
export function MediaGrid(params: MediaListParams & { empty?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError, refetch } =
    useInfiniteQuery(mediaListOptions(params));
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isError && items.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 text-center">
        <p className="text-ink-muted">Không tải được danh sách.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 font-semibold text-brand-700"
        >
          Thử lại
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-ink-muted">
        {params.empty ?? "Chưa có nội dung nào trong mục này."}
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m, i) => (
          <MediaCard key={m.id} media={m} eager={i < 4} />
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
