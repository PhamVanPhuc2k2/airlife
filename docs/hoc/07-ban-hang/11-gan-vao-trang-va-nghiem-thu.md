# Bài 7.11: Gắn bán hàng vào các trang có sẵn; nghiệm thu Phần 07

> [← Bài trước](10-thanh-toan-va-don-hang.md) · [Mục lục](../README.md)

## Mục tiêu

- Trang chủ: khối "Kinh doanh" ở hàng dưới (cạnh "Nghe nhiều"), như mockup.
- Trang xem: "Sản phẩm trong video".
- Trang kênh: "Gian hàng" cho kênh có sản phẩm.
- Trang Bạn: đơn hàng gần đây, số đơn hàng. Sưu tập: tab "Yêu thích".

## Bạn sẽ học

- `fetchInfiniteQuery` (khác `prefetchInfiniteQuery`): lấy sẵn **và** đọc được dữ liệu để quyết định hiện
  khối nào.
- Gọi song song nhiều API ở server component bằng `Promise.all`.

## Viết code

### Bước 1: Danh sách sản phẩm gọn, `frontend/src/components/product/ProductMiniList.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";

import type { ProductCard } from "@/lib/types";

import { Price } from "./Price";
import { productHref } from "./ProductCard";

// Danh sách sản phẩm gọn: ảnh nhỏ, tên, giá (khối "Kinh doanh" ở trang chủ, "Sản phẩm trong
// video" ở trang xem; mockup: product-mini)
export function ProductMiniList({ items }: { items: ProductCard[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={productHref(p)} className="group flex items-center gap-3">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
              <Image src={p.image_url} alt="" fill sizes="64px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-semibold group-hover:text-brand-700">
                {p.name}
              </span>
              <Price
                price={p.price}
                oldPrice={p.old_price}
                prefix={p.kind === "booking" ? "Từ" : undefined}
              />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

### Bước 2: Trang chủ, `frontend/src/app/page.tsx`

```tsx
import { HotComments } from "@/components/comment/HotComments";
import { FeaturedHero } from "@/components/media/FeaturedHero";
import { MediaCard } from "@/components/media/MediaCard";
import { MediaTile } from "@/components/media/MediaTile";
import { RankList } from "@/components/media/RankList";
import { ProductMiniList } from "@/components/product/ProductMiniList";
import { Panel } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import type { Home } from "@/lib/types";

// Trang lấy dữ liệu từ API lúc có request, không dựng sẵn lúc build (lúc build không có API
// để gọi). Dữ liệu đã được backend cache 60 giây bằng Redis.
export const dynamic = "force-dynamic";

// Server component: lấy dữ liệu ngay trên server, gửi về HTML có sẵn nội dung (tốt cho SEO,
// hiện nhanh). Chỉ cột Bình luận nổi bật (đổi tab Hay/Nhiều) là client component.
export default async function HomePage() {
  const home = await api<Home>("/home");

  return (
    <div className="mx-auto max-w-[1680px] space-y-8 px-3 py-4 md:px-6 md:py-6">
      {/* Bố cục theo bản vẽ tay của mockup: 3 ô | khối nổi bật | bình luận nổi bật */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)_minmax(280px,1fr)]">
        <div className="lg:order-2">{home.featured && <FeaturedHero media={home.featured} />}</div>

        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 [scrollbar-width:none] lg:order-1 lg:mx-0 lg:grid lg:grid-rows-3 lg:overflow-visible lg:px-0">
          {home.latest.map((m) => (
            <div key={m.id} className="w-[72%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
              <MediaTile media={m} />
            </div>
          ))}
        </div>

        {/* Màn ≥ 1280px: cao bằng khối nổi bật, cuộn bên trong */}
        <div className="lg:order-3 lg:col-span-2 xl:col-span-1 xl:max-h-[560px]">
          <HotComments top={home.hot_comments.top} replied={home.hot_comments.replied} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Đang được xem nhiều</h2>
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
          {home.trending.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      </section>

      {/* Hàng dưới của mockup: Nghe nhiều | Kinh doanh | Tiện ích (Phần 10) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Nghe nhiều" icon="sound" moreHref="/nghe?sort=popular">
          <RankList items={home.top_listen} />
        </Panel>
        <Panel title="Kinh doanh" icon="briefcase" moreHref="/kinh-doanh?sort=bestseller">
          <ProductMiniList items={home.shop} />
        </Panel>
      </section>
    </div>
  );
}
```

### Bước 3: Trang xem, `frontend/src/components/watch/WatchPage.tsx`

Lấy gợi ý và sản phẩm **song song** (`Promise.all`), hiện khối "Sản phẩm trong video" trên cột phải. Bản
đầy đủ:

```tsx
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { FollowButton } from "@/components/channel/FollowButton";
import { CommentSection } from "@/components/comment/CommentSection";
import { MediaActions } from "@/components/library/MediaActions";
import { ResumeNote } from "@/components/library/ResumeNote";
import { mediaHref, viewWord } from "@/components/media/links";
import { PlayerSlot } from "@/components/player/PlayerSlot";
import { ProductMiniList } from "@/components/product/ProductMiniList";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard, ProductCard } from "@/lib/types";

import { getMedia } from "./get-media";

// Trang xem / nghe một media: trình phát, thông tin, kênh, mô tả, gợi ý bên phải.
export async function WatchPage({ category, slug }: { category: "xem" | "nghe"; slug: string }) {
  const media = await getMedia(slug);
  // /nghe/<slug-của-phim> → chuyển về đúng /xem/<slug> (308), để mỗi nội dung chỉ có một URL
  if (media.category !== category) permanentRedirect(mediaHref(media));

  const [related, products] = await Promise.all([
    api<MediaCard[]>(`/media/${encodeURIComponent(slug)}/related`),
    api<ProductCard[]>(`/media/${encodeURIComponent(slug)}/products`),
  ]);

  return (
    <div className="mx-auto grid max-w-[1680px] gap-6 px-3 py-4 md:px-6 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {media.youtube_id ? (
          <PlayerSlot
            media={{
              slug: media.slug,
              category: media.category,
              title: media.title,
              channel: media.channel.name,
              thumbnail: media.thumbnail_url,
              youtubeId: media.youtube_id,
            }}
          />
        ) : (
          <NoVideo thumbnail={media.thumbnail_url} />
        )}
        {media.youtube_id && <ResumeNote slug={media.slug} />}

        <h1 className="mt-4 text-xl font-bold md:text-2xl">{media.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
          <time dateTime={media.published_at}>{timeAgo(media.published_at)}</time> ·{" "}
          {media.group_label} · {media.genre_label}
          {durationLabel(media) && ` · ${durationLabel(media)}`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/kenh/${media.channel.slug}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <Avatar name={media.channel.name} />
            <span className="flex items-center gap-1 font-semibold hover:text-brand-700">
              {media.channel.name}
              {media.channel.verified && <Icon name="check" className="size-4 text-brand-600" />}
            </span>
          </Link>
          <FollowButton
            slug={media.channel.slug}
            initial={{ following: false, followers_count: media.channel.followers_count ?? 0 }}
          />
          <MediaActions slug={media.slug} title={media.title} />
        </div>

        <div className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-4 text-[15px] leading-relaxed">
          {media.lineup_month && (
            <p className="mb-2 text-sm font-semibold text-accent-700">
              Line-up phim tháng {media.lineup_month.split("-").reverse().join("/")}
            </p>
          )}
          {media.description || "Chưa có mô tả."}
        </div>

        <CommentSection target={{ kind: "media", slug: media.slug }} />
      </div>

      <aside aria-label="Có thể bạn thích" className="space-y-6">
        {/* Sản phẩm gắn trong video (mockup: "Sản phẩm trong video") */}
        {products.length > 0 && (
          <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]">
            <h2 className="mb-3 font-bold">Sản phẩm trong video</h2>
            <ProductMiniList items={products} />
          </section>
        )}
        <div>
          <h2 className="mb-3 font-bold">Có thể bạn thích</h2>
          <ul className="grid gap-3">
            {related.map((m) => (
              <li key={m.id}>
                <RelatedItem media={m} />
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function NoVideo({ thumbnail }: { thumbnail: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-overlay">
      <Image
        src={thumbnail}
        alt=""
        fill
        sizes="(min-width: 1024px) 60vw, 100vw"
        className="object-cover opacity-40"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white">
        <Icon name="screen" className="size-12 text-white/70" />
        <p className="mt-3 font-semibold">Nội dung này chưa có video</p>
        <p className="text-sm text-white/70">Video sẽ được cập nhật sớm.</p>
      </div>
    </div>
  );
}

function RelatedItem({ media }: { media: MediaCard }) {
  return (
    <Link href={mediaHref(media)} className="group flex gap-3">
      <span className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
        <Image src={media.thumbnail_url} alt="" fill sizes="160px" className="object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
          {durationLabel(media)}
        </span>
      </span>
      <span className="grid min-w-0 content-start">
        <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
          {media.title}
        </strong>
        <small className="mt-1 truncate text-ink-muted">{media.channel.name}</small>
        <small className="text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)}
        </small>
      </span>
    </Link>
  );
}
```

### Bước 4: Gian hàng ở trang kênh, `frontend/src/app/kenh/[slug]/page.tsx`

```tsx
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
```

`MediaGrid`, `ProductGrid` nhận thêm `empty` (câu hiện khi trống); `MediaGrid` bản đầy đủ:

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { MediaCard } from "@/components/media/MediaCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";

// Lưới media cuộn tải thêm (LoadMore). Trang đầu đã được server lấy sẵn (CategoryPage → prefetch),
// nên lần render đầu có dữ liệu ngay, không có màn "đang tải".
export function MediaGrid(params: MediaListParams & { empty?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError, refetch } =
    useInfiniteQuery(mediaListOptions(params));
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
    return (
      <p className="py-16 text-center text-ink-muted">
        {params.empty ?? "Chưa có nội dung nào trong mục này."}
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m, i) => (
          <MediaCard key={m.id} media={m} eager={i < 4} />
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
```

### Bước 5: Trang Bạn và Sưu tập

`frontend/src/app/ban/page.tsx` thêm "Đơn hàng của bạn":

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { ContinueWatching } from "@/components/account/ContinueWatching";
import { FollowingChannels } from "@/components/account/FollowingChannels";
import { LibraryStats } from "@/components/account/LibraryStats";
import { ProfileCard } from "@/components/account/ProfileCard";
import { OrderList } from "@/components/shop/OrderList";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn (mockup: renderMe). Mọi khối là dữ liệu riêng của người đang đăng nhập nên lấy ở
// trình duyệt (có cookie). Mockup còn có chuyến bay sắp tới (Phần 10).
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-3 py-6 md:px-6">
      <div className="space-y-3">
        <ProfileCard />
        <LibraryStats />
      </div>
      <section aria-labelledby="don-hang">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="don-hang" className="text-xl font-bold">
            Đơn hàng của bạn
          </h2>
          <Link href="/don-hang" className="text-sm font-semibold text-brand-700">
            Xem tất cả
          </Link>
        </div>
        <OrderList limit={3} />
      </section>
      <ContinueWatching />
      <FollowingChannels />
    </div>
  );
}
```

`LibraryStats` đổi ô "Đã xem" thành "Đơn hàng" (`data?.orders`, link `/don-hang`). Bản đầy đủ:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { api } from "@/lib/api";
import type { LibraryStats as Stats } from "@/lib/types";

// Bốn con số dưới thẻ hồ sơ (mockup: profile__stats). Bấm vào là tới đúng tab Sưu tập.
export function LibraryStats() {
  const { data } = useQuery({
    queryKey: ["me", "stats"],
    queryFn: () => api<Stats>("/me/stats"),
  });
  const items = [
    { label: "Đang theo dõi", value: data?.following, href: "#kenh-theo-doi" },
    { label: "Đã lưu", value: data?.saved, href: "/suu-tap?tab=da-luu" },
    { label: "Playlist", value: data?.playlists, href: "/suu-tap" },
    { label: "Đơn hàng", value: data?.orders, href: "/don-hang" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <li key={it.label}>
          <Link
            href={it.href}
            className="block rounded-card bg-surface p-4 text-center shadow-sm ring-1 ring-ink/[0.07] transition hover:ring-brand-300"
          >
            <b className="block text-2xl font-bold">{it.value ?? "–"}</b>
            <small className="text-sm text-ink-muted">{it.label}</small>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

Tab "Yêu thích", `frontend/src/components/library/FavoriteGrid.tsx`:

```tsx
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
```

`frontend/src/app/suu-tap/page.tsx`:

```tsx
import type { Metadata } from "next";

import { FavoriteGrid } from "@/components/library/FavoriteGrid";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { PlaylistGrid } from "@/components/library/PlaylistGrid";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";

export const metadata: Metadata = { title: "Sưu tập", robots: { index: false } };

const TABS = [
  { key: "playlist", label: "Playlist" },
  { key: "da-luu", label: "Đã lưu" },
  { key: "yeu-thich", label: "Yêu thích" },
  { key: "da-xem", label: "Đã xem" },
] as const;

type Props = { searchParams: Promise<{ tab?: string }> };

// Sưu tập (mockup: renderCollection). Mỗi tab là một link ?tab=… (dán link là mở đúng tab).
// Trang chỉ dựng khung; danh sách là dữ liệu riêng nên client component lấy ở trình duyệt.
export default async function Page({ searchParams }: Props) {
  const { tab: raw } = await searchParams;
  const tab = TABS.find((t) => t.key === raw)?.key ?? "playlist";

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="library"
        title="Sưu tập"
        desc="Playlist của bạn, nội dung đã lưu để xem sau, sản phẩm và tour yêu thích, lịch sử xem."
      />
      <TabLinks
        label="Sưu tập"
        items={TABS.map((t) => ({
          label: t.label,
          href: t.key === "playlist" ? "/suu-tap" : `/suu-tap?tab=${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "playlist" && <PlaylistGrid />}
      {tab === "da-luu" && <LibraryGrid list="saved" />}
      {tab === "yeu-thich" && <FavoriteGrid />}
      {tab === "da-xem" && <LibraryGrid list="history" />}
    </div>
  );
}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
```

Nghiệm thu Phần 07 trên trình duyệt (bắt đầu khi **chưa** đăng nhập):

| Làm gì | Thấy gì |
|---|---|
| Trang chủ, cuộn xuống | Hàng dưới: "Nghe nhiều" và "Kinh doanh" (4 sản phẩm bán chạy) |
| `/xem/vung-troi-cuoi-cung` | Cột phải có "Sản phẩm trong video": nước hoa, đồng hồ |
| `/kenh/duty-free-sg` | "Gian hàng" 2 sản phẩm, rồi "Nội dung" |
| `/kenh/airlife` | Không có khối "Gian hàng" |
| Thêm nước hoa và cà phê vào giỏ, mở giỏ | Cảnh báo không có cách nhận chung; bỏ nước hoa |
| Đăng ký, xác minh email, mở giỏ | Giỏ còn cà phê (đã gộp lên server) |
| Đặt hàng giao tận nhà | Trang đơn "Đặt hàng thành công!", Mailpit có thư |
| `/ban` | "Đơn hàng của bạn" có đơn vừa đặt; ô "Đơn hàng" là 1 |
| Trang tour Nhật Bản: bấm trái tim; mở `/suu-tap?tab=yeu-thich` | Có tour đó; bấm trái tim trên thẻ thì bỏ |
| Huỷ đơn | "Đã huỷ"; tồn kho cà phê trở lại như trước |
| Console suốt quá trình | Không có lỗi, không có cảnh báo |

Dọn tài khoản thử như bài 7.06, rồi:

```bash
git add . && git commit -m "Bán hàng: trang sản phẩm, giỏ hàng, thanh toán, đơn hàng"
```

Đến đây xong Phần 07.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Kênh không bán gì vẫn hiện tiêu đề "Gian hàng" trống | Dùng `prefetchInfiniteQuery` (không trả dữ liệu); đổi sang `fetchInfiniteQuery` và kiểm tra trang đầu |
| Trang xem chậm hơn trước | Gọi hai API lần lượt (`await` rồi `await`); dùng `Promise.all` |
