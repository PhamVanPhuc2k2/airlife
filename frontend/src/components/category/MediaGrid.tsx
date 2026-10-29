"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { MediaCard } from "@/components/media/MediaCard";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";

// Lưới media cuộn tải thêm. Trang đầu đã được server lấy sẵn (CategoryPage → prefetch), nên
// lần render đầu có dữ liệu ngay, không có màn "đang tải".
export function MediaGrid(params: MediaListParams) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError, refetch } =
    useInfiniteQuery(mediaListOptions(params));
  const sentinel = useRef<HTMLDivElement>(null);

  // Cuộn tới gần cuối lưới thì tự tải trang tiếp. IntersectionObserver báo khi ô "lính gác"
  // (sentinel) lọt vào màn hình, không phải nghe sự kiện scroll liên tục.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px" }, // tải trước khi khách cuộn tới đáy hẳn
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
    return <p className="py-16 text-center text-ink-muted">Chưa có nội dung nào trong mục này.</p>;
  }

  return (
    <>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m, i) => (
          <MediaCard key={m.id} media={m} priority={i < 4} />
        ))}
      </div>
      <div ref={sentinel} />
      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          {/* Nút dự phòng: trình duyệt cũ, hoặc người dùng bàn phím */}
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="h-10 rounded-full bg-surface-2 px-6 font-semibold text-ink-2 hover:bg-surface-3 disabled:opacity-60"
          >
            {isFetchingNextPage ? "Đang tải…" : "Xem thêm"}
          </button>
        </div>
      )}
    </>
  );
}
