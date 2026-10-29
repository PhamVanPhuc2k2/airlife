import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Icon } from "@/components/icons/Icon";
import { MediaCard } from "@/components/media/MediaCard";
import { BuyBox } from "@/components/product/BuyBox";
import { Gallery } from "@/components/product/Gallery";
import { ProductCard } from "@/components/product/ProductCard";
import { Avatar } from "@/components/ui/Avatar";
import { ApiError, api } from "@/lib/api";
import { compactNumber } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

const getProduct = cache(async (slug: string) => {
  try {
    return await api<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  return {
    title: p.name,
    description: p.description,
    openGraph: { title: p.name, description: p.description, images: [p.image_url] },
  };
}

// Trang sản phẩm (mockup: renderProduct). Thông tin chung dựng ở server (SEO, hiện nhanh); khối
// mua hàng là client component (chọn biến thể, giỏ hàng).
export default async function Page({ params }: Props) {
  const p = await getProduct((await params).slug);
  const booking = p.kind === "booking";

  // Dữ liệu có cấu trúc schema.org: Google hiện giá, đánh giá ngay trong kết quả tìm kiếm
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: [p.image_url, ...p.gallery],
    description: p.description,
    brand: { "@type": "Brand", name: p.channel.name },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: p.rating,
      reviewCount: p.rating_count,
    },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "VND",
      lowPrice: p.price,
      offerCount: Math.max(p.variants.length, 1),
    },
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-10 px-3 py-5 md:px-6">
      <script
        type="application/ld+json"
        // JSON.stringify không escape "</script>": thay "<" để tên sản phẩm không đóng được thẻ script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <nav
        aria-label="Đường dẫn"
        className="flex flex-wrap items-center gap-1 text-sm text-ink-muted"
      >
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        <Icon name="chevron" className="size-4" />
        <Link href={`/${p.category}`} className="hover:text-ink">
          {p.category_name}
        </Link>
        <Icon name="chevron" className="size-4" />
        <Link href={`/${p.category}?f=${p.tag}`} className="hover:text-ink">
          {p.tag_name}
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Gallery images={[p.image_url, ...p.gallery]} alt={p.name} />
        <div className="space-y-5">
          <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
            {p.tag_name}
          </span>
          <h1 className="text-2xl font-bold md:text-3xl">{p.name}</h1>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
            <span className="flex items-center gap-1">
              <Icon name="star" className="size-4 fill-current text-accent-light" />
              <b className="text-ink">{p.rating.toLocaleString("vi-VN")}</b> ({p.rating_count} đánh
              giá)
            </span>
            <span>
              {booking ? "Đã đặt" : "Đã bán"} {p.sold_count.toLocaleString("vi-VN")}
            </span>
          </p>
          <BuyBox product={p} />
          <Link
            href={`/kenh/${p.channel.slug}#gian-hang`}
            className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07] hover:ring-brand-300"
          >
            <Avatar name={p.channel.name} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 font-semibold">
                {p.channel.name}
                {p.channel.verified && <Icon name="check" className="size-4 text-brand-600" />}
              </span>
              <span className="text-sm text-ink-muted">
                {compactNumber(p.channel.followers_count ?? 0)} người theo dõi
              </span>
            </span>
            <span className="text-sm font-semibold text-brand-700">Xem gian hàng</span>
          </Link>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07]">
          <h2 className="text-xl font-bold">{booking ? "Chi tiết" : "Mô tả sản phẩm"}</h2>
          <div
            className="prose mt-3 max-w-none prose-a:text-brand-700"
            // body_html đã lọc bằng bluemonday khi ghi (seed, trang quản trị)
            dangerouslySetInnerHTML={{ __html: p.body_html }}
          />
          <p className="mt-3 text-ink-2">
            {booking
              ? `Cung cấp bởi ${p.channel.name} trên Airlife.`
              : `Sản phẩm được bán bởi ${p.channel.name} trên Airlife. Đặt ngay trong chuyến bay, thanh toán khi nhận hàng.`}
          </p>
        </section>
        {p.media.length > 0 && (
          <aside aria-labelledby="xuat-hien-trong">
            <h2 id="xuat-hien-trong" className="mb-4 text-lg font-bold">
              Xuất hiện trong
            </h2>
            <div className="grid gap-5">
              {p.media.map((m) => (
                <MediaCard key={m.id} media={m} />
              ))}
            </div>
          </aside>
        )}
      </div>

      {p.related.length > 0 && (
        <section aria-labelledby="lien-quan">
          <h2 id="lien-quan" className="mb-4 text-xl font-bold">
            Có thể bạn cũng thích
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4">
            {p.related.map((x) => (
              <ProductCard key={x.id} product={x} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
