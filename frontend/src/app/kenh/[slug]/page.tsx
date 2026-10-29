import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { MediaGrid } from "@/components/category/MediaGrid";
import { FollowButton } from "@/components/channel/FollowButton";
import { ProductGrid } from "@/components/product/ProductGrid";
import { CHANNEL_TYPE_LABEL } from "@/components/channel/labels";
import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { ApiError, api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { mediaListOptions, productListOptions } from "@/lib/queries";
import type { ChannelDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

const getChannel = cache(async (slug: string) => {
  try {
    return await api<ChannelDetail>(`/channels/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getChannel((await params).slug);
  return { title: c.name, description: c.description };
}

// Trang kênh (mockup: kenh.html): ảnh bìa, thông tin, nút theo dõi, nội dung của kênh.
export default async function ChannelPage({ params }: Props) {
  const { slug } = await params;
  const queryClient = getQueryClient();
  const [channel] = await Promise.all([
    getChannel(slug),
    queryClient.prefetchInfiniteQuery(mediaListOptions({ channel: slug, sort: "new" })),
  ]);
  // Gian hàng: chỉ kênh doanh nghiệp có sản phẩm. fetchInfiniteQuery (khác prefetch) trả dữ liệu
  // để biết có hiện khối này không; dữ liệu cũng nằm trong cache, ProductGrid dùng lại.
  const shop = await queryClient.fetchInfiniteQuery(productListOptions({ channel: slug }));
  const hasShop = (shop.pages[0]?.items.length ?? 0) > 0;

  return (
    <div>
      {/* Ảnh bìa: chưa có ảnh thật cho kênh, dùng dải màu thương hiệu */}
      <div className="h-32 bg-gradient-brand md:h-48" />
      <div className="mx-auto max-w-[1680px] px-3 md:px-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end">
          {/* Chỉ avatar đè lên ảnh bìa (margin âm); chữ nằm dưới ảnh bìa cho dễ đọc */}
          <span className="-mt-10 w-fit shrink-0 rounded-full ring-4 ring-bg md:-mt-12">
            <Avatar name={channel.name} size="lg" />
          </span>
          <div className="min-w-0 flex-1 md:pt-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
              {channel.name}
              {channel.verified && (
                <span title="Kênh đã xác minh">
                  <Icon name="check" className="size-6 text-brand-600" />
                  <span className="sr-only">(đã xác minh)</span>
                </span>
              )}
            </h1>
            <p className="text-ink-muted">
              {CHANNEL_TYPE_LABEL[channel.type]} · {channel.media_count} nội dung
            </p>
            <p className="mt-1 max-w-3xl text-ink-2">{channel.description}</p>
          </div>
          <FollowButton
            slug={channel.slug}
            initial={{ following: channel.following, followers_count: channel.followers_count }}
          />
        </header>

        <HydrationBoundary state={dehydrate(queryClient)}>
          {hasShop && (
            <section id="gian-hang" className="mt-8 scroll-mt-36">
              <h2 className="mb-4 text-xl font-bold">Gian hàng</h2>
              <ProductGrid channel={slug} />
            </section>
          )}
          <section className="mt-8 pb-6">
            <h2 className="mb-4 text-xl font-bold">Nội dung</h2>
            <MediaGrid channel={slug} sort="new" empty="Kênh chưa đăng nội dung nào." />
          </section>
        </HydrationBoundary>
      </div>
    </div>
  );
}
