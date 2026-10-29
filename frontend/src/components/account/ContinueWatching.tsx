"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { MediaCard } from "@/components/media/MediaCard";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";

// Hàng "Tiếp tục xem" ở trang Bạn: những nội dung xem dở, mới xem nhất trước. Trên điện thoại
// vuốt ngang (như 3 ô ở trang chủ), màn rộng thì thành lưới.
export function ContinueWatching() {
  const { data, isPending } = useQuery({
    queryKey: ["me", "continue"],
    queryFn: () => api<LibraryItem[]>("/me/continue"),
  });
  if (isPending) return <div className="h-56 animate-pulse rounded-card bg-surface-2" />;
  if (!data?.length) return null; // chưa xem dở gì: ẩn cả khối

  return (
    <section aria-labelledby="tiep-tuc-xem">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="tiep-tuc-xem" className="text-xl font-bold">
          Tiếp tục xem
        </h2>
        <Link href="/suu-tap?tab=da-xem" className="text-sm font-semibold text-brand-700">
          Xem tất cả
        </Link>
      </div>
      <div className="-mx-3 flex snap-x gap-4 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {data.slice(0, 6).map((m) => (
          <div key={m.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
            <MediaCard media={m} progress={m.progress} />
          </div>
        ))}
      </div>
    </section>
  );
}
