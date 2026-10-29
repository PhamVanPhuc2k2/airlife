import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

import { FilterChips } from "@/components/category/FilterChips";
import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { productListOptions } from "@/lib/queries";
import type { Category } from "@/lib/types";

import { ProductGrid } from "./ProductGrid";

type Props = {
  slug: "kinh-doanh" | "tour-bay";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SORTS = [
  { value: "new", label: "Mới nhất" },
  { value: "bestseller", label: "Bán chạy" },
] as const;

// Trang chuyên mục Kinh doanh / Tour bay. Cùng cách làm với CategoryPage của Xem/Nghe: chip lọc
// là link, server lấy sẵn trang đầu rồi client dùng tiếp (prefetch + HydrationBoundary).
export async function ProductCategoryPage({ slug, searchParams }: Props) {
  const sp = await searchParams;
  const tag = typeof sp.f === "string" ? sp.f : undefined;
  const sort = sp.sort === "bestseller" ? "bestseller" : "new";

  const queryClient = getQueryClient();
  const [category] = await Promise.all([
    api<Category>(`/categories/${slug}`),
    queryClient.prefetchInfiniteQuery(productListOptions({ category: slug, tag, sort })),
  ]);

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-5 md:px-6">
      <header>
        <h1 className="text-2xl font-bold md:text-3xl">{category.title}</h1>
        <p className="mt-1 max-w-3xl text-ink-muted">{category.description}</p>
      </header>
      <FilterChips
        basePath={`/${slug}`}
        filters={category.filters ?? []}
        activeTag={tag}
        sorts={SORTS}
        sort={sort}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ProductGrid category={slug} tag={tag} sort={sort} />
      </HydrationBoundary>
    </div>
  );
}
