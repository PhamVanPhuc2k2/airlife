import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { compactNumber, discountPercent } from "@/lib/format";
import type { ProductCard as Product } from "@/lib/types";

import { Price } from "./Price";

export const productHref = (p: Pick<Product, "slug">) => `/san-pham/${p.slug}`;

// Thẻ sản phẩm (mockup: productCard): ảnh vuông, nhãn giảm giá, loại, tên, đánh giá, đã bán, giá.
export function ProductCard({
  product: p,
  action,
  eager = false,
}: {
  product: Product;
  action?: React.ReactNode;
  eager?: boolean; // thẻ ở màn hình đầu: tải ảnh ngay, không chờ cuộn tới
}) {
  const off = discountPercent(p.price, p.old_price);
  const booking = p.kind === "booking";
  return (
    <article className="group flex flex-col overflow-hidden rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
      <Link
        href={productHref(p)}
        className="relative block aspect-square bg-surface-3"
        tabIndex={-1}
      >
        <Image
          src={p.image_url}
          alt=""
          fill
          loading={eager ? "eager" : "lazy"}
          sizes="(min-width: 1280px) 20vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
        />
        {off > 0 && (
          <span className="absolute left-2 top-2 rounded-md bg-danger px-1.5 py-0.5 text-xs font-bold text-white">
            -{off}%
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="flex items-center justify-between gap-2 text-xs font-semibold text-brand-700">
          {p.tag_name}
          {action}
        </p>
        <h3 className="line-clamp-2 font-semibold leading-snug">
          <Link href={productHref(p)} className="hover:text-brand-700">
            {p.name}
          </Link>
        </h3>
        <p className="flex items-center gap-1 text-xs text-ink-muted">
          <Icon name="star" className="size-3.5 fill-current text-accent-light" />
          {p.rating.toLocaleString("vi-VN")} · {booking ? "Đã đặt" : "Đã bán"}{" "}
          {compactNumber(p.sold_count)}
        </p>
        <div className="mt-auto pt-1">
          <Price price={p.price} oldPrice={p.old_price} prefix={booking ? "Từ" : undefined} />
        </div>
      </div>
    </article>
  );
}
