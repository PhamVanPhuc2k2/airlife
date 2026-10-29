"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { LoadMore } from "@/components/ui/LoadMore";
import { type ProductListParams, productListOptions } from "@/lib/queries";

import { ProductCard } from "./ProductCard";

// Lưới sản phẩm cuộn tải thêm (như MediaGrid, bài 2.11)
export function ProductGrid(params: ProductListParams & { empty?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    productListOptions(params),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (data && items.length === 0) {
    return (
      <p className="py-16 text-center text-ink-muted">
        {params.empty ?? "Chưa có sản phẩm nào trong mục này."}
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((p, i) => (
          <ProductCard key={p.id} product={p} eager={i < 4} />
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
