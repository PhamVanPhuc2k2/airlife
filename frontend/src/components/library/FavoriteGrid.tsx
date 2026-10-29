"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons/Icon";
import { ProductCard } from "@/components/product/ProductCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { api } from "@/lib/api";
import { favoritesOptions } from "@/lib/queries";

// Tab "Yêu thích" ở Sưu tập: sản phẩm, tour đã bấm trái tim
export function FavoriteGrid() {
  const qc = useQueryClient();
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(favoritesOptions());
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const remove = useMutation({
    mutationFn: (slug: string) => api<void>(`/me/favorites/${slug}`, { method: "DELETE" }),
    onSettled: (_d, _e, slug) => {
      void qc.invalidateQueries({ queryKey: ["me", "favorites"] });
      void qc.invalidateQueries({ queryKey: ["me", "product", slug] });
    },
  });

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Chưa có sản phẩm yêu thích. Bấm biểu tượng trái tim ở trang sản phẩm để lưu lại.
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((p, i) => (
          <ProductCard
            key={p.id}
            product={p}
            eager={i < 4}
            action={
              <button
                type="button"
                onClick={() => remove.mutate(p.slug)}
                disabled={remove.isPending}
                aria-label="Bỏ yêu thích"
                title="Bỏ yêu thích"
                className="text-danger hover:opacity-70"
              >
                <Icon name="heart" className="size-4 fill-current" />
              </button>
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
