"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { LoadMore } from "@/components/ui/LoadMore";
import { newsListOptions } from "@/lib/queries";

import { NewsCard } from "./NewsCard";
import { NewsLead } from "./NewsLead";

// Danh sách bài viết cuộn tải thêm. withLead: bài mới nhất hiện thành khối lớn ở đầu
// (chỉ khi xem "Tất cả", như mockup).
export function NewsGrid({ category, withLead }: { category?: string; withLead: boolean }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    newsListOptions(category),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return <p className="py-16 text-center text-ink-muted">Chưa có bài viết.</p>;
  }

  const [lead, ...rest] = items;
  const grid = withLead ? rest : items;
  return (
    <div className="space-y-6">
      {withLead && lead && <NewsLead news={lead} />}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {grid.map((n) => (
          <NewsCard key={n.id} news={n} />
        ))}
      </div>
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </div>
  );
}
