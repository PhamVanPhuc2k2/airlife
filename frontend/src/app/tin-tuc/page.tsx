import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

import { NewsGrid } from "@/components/news/NewsGrid";
import { ChipLinks } from "@/components/ui/ChipLinks";
import { PageHead } from "@/components/ui/PageHead";
import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { newsListOptions } from "@/lib/queries";
import type { NewsCategory } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Tin tức",
  description: "Khám phá điểm đến, sự kiện, mẹo bay và line-up phim trên Airlife.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Cùng mẫu với trang chuyên mục (bài 2.11): server lấy sẵn trang đầu, client cuộn tải thêm.
export default async function NewsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const category = typeof sp.f === "string" ? sp.f : undefined;

  const queryClient = getQueryClient();
  const [categories] = await Promise.all([
    api<NewsCategory[]>("/news/categories"),
    queryClient.prefetchInfiniteQuery(newsListOptions(category)),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-5 md:px-6">
      <PageHead
        icon="news"
        title="Tin tức"
        desc="Khám phá điểm đến, sự kiện, mẹo bay và line-up phim trên Airlife."
      />
      <ChipLinks
        items={[
          { href: "/tin-tuc", label: "Tất cả", active: !category },
          ...categories.map((c) => ({
            href: `/tin-tuc?f=${c.slug}`,
            label: c.name,
            active: category === c.slug,
          })),
        ]}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <NewsGrid category={category} withLead={!category} />
      </HydrationBoundary>
    </div>
  );
}
