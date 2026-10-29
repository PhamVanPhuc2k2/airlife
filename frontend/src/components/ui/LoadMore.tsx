"use client";

import { useEffect, useRef } from "react";

type Props = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

// Cuộn tới gần cuối danh sách thì tự tải trang tiếp (ô "lính gác" + IntersectionObserver),
// kèm nút "Xem thêm" dự phòng. Dùng chung cho mọi danh sách useInfiniteQuery.
export function LoadMore({ hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const sentinel = useRef<HTMLDivElement>(null);

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

  return (
    <>
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
