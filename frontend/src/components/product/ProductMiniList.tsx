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
