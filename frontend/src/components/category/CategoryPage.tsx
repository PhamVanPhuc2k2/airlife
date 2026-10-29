import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { mediaListOptions } from "@/lib/queries";
import type { Category } from "@/lib/types";

import { FilterChips } from "./FilterChips";
import { MediaGrid } from "./MediaGrid";

type Props = {
  slug: "xem" | "nghe";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Trang chuyên mục Xem / Nghe (dùng chung cho hai route).
//
// "Lấy sẵn trên server, dùng tiếp ở client" (prefetch + HydrationBoundary):
//   1. Server tạo QueryClient, prefetchInfiniteQuery trang đầu.
//   2. dehydrate() chuyển cache đó thành JSON, gửi kèm HTML.
//   3. Ở trình duyệt, HydrationBoundary nạp JSON vào QueryClient; MediaGrid gọi
//      useInfiniteQuery với CÙNG key nên có dữ liệu ngay, rồi tự tải các trang sau.
export async function CategoryPage({ slug, searchParams }: Props) {
  const sp = await searchParams;
  const tag = typeof sp.f === "string" ? sp.f : undefined;
  const sort = sp.sort === "popular" ? "popular" : "new";

  const queryClient = getQueryClient();
  const [category] = await Promise.all([
    api<Category>(`/categories/${slug}`),
    queryClient.prefetchInfiniteQuery(mediaListOptions({ category: slug, tag, sort })),
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
        sort={sort}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <MediaGrid category={slug} tag={tag} sort={sort} />
      </HydrationBoundary>
    </div>
  );
}
