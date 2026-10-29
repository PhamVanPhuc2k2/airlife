# Bài 7.08: Trang sản phẩm: ảnh, chọn biến thể, yêu thích, dữ liệu cho Google

> [← Bài trước](07-frontend-danh-muc.md) · [Mục lục](../README.md) · [Bài sau →](09-gio-hang.md)

## Mục tiêu

`/san-pham/[slug]` (mockup `renderProduct`): bộ ảnh, loại, đánh giá, đã bán, giá theo biến thể đang chọn,
cách nhận hàng, số lượng, "Thêm vào giỏ", "Mua ngay", yêu thích, người bán, mô tả, "Xuất hiện trong" (video),
"Có thể bạn cũng thích".

## Bạn sẽ học

- Chia trang thành phần server (nội dung, SEO) và phần client nhỏ (khối mua hàng).
- Radio ẩn + nhãn tự vẽ mà vẫn dùng được bằng bàn phím (`sr-only`, `has-[:focus-visible]`).
- JSON-LD (schema.org `Product`) và cách nhúng an toàn.

## Viết code

### Bước 1: Bộ ảnh, `frontend/src/components/product/Gallery.tsx`

```tsx
"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/cn";

// Ảnh lớn + hàng ảnh nhỏ để chọn (mockup: .gallery)
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-card bg-surface-3">
        <Image
          src={images[active] ?? images[0] ?? ""}
          alt={alt}
          fill
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Ảnh ${i + 1}`}
            aria-pressed={i === active}
            className={cn(
              "relative aspect-square overflow-hidden rounded-card-sm bg-surface-3 ring-2 transition",
              i === active ? "ring-brand-600" : "ring-transparent hover:ring-brand-200",
            )}
          >
            {/* eager: ảnh nhỏ đầu tiên trùng địa chỉ với ảnh lớn; để lazy thì Next.js tưởng ảnh
                LCP (ảnh lớn) đang tải lười và cảnh báo. Hàng ảnh nhỏ cũng nằm ở màn hình đầu. */}
            <Image src={src} alt="" fill loading="eager" sizes="120px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
```

Ảnh nhỏ đầu tiên **trùng địa chỉ** với ảnh lớn. Next.js theo dõi ảnh theo địa chỉ; nếu ảnh nhỏ để `lazy`,
nó tưởng ảnh lớn (ảnh LCP) đang tải lười và cảnh báo, dù ảnh lớn đã `eager`. Hàng ảnh nhỏ cũng nằm ở màn
hình đầu nên cho tải ngay luôn.

### Bước 2: Yêu thích, `frontend/src/components/product/FavoriteButton.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";

const cls =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition hover:bg-surface-3";

// Nút trái tim "Yêu thích" ở trang sản phẩm (tab Yêu thích ở Sưu tập)
export function FavoriteButton({ slug }: { slug: string }) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();
  const key = ["me", "product", slug];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ favorite: boolean }>(`/me/products/${slug}`),
    enabled: !!me,
  });
  const fav = data?.favorite ?? false;
  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api<void>(`/me/favorites/${slug}`, { method: next ? "PUT" : "DELETE" }),
    onMutate: (next) => qc.setQueryData(key, { favorite: next }),
    onError: (_e, next) => qc.setQueryData(key, { favorite: !next }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["me", "favorites"] }),
  });

  if (!me) {
    return (
      <Link
        href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
        className={cls}
        aria-label="Yêu thích"
      >
        <Icon name="heart" className="size-5" />
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => toggle.mutate(!fav)}
      disabled={!data}
      aria-pressed={fav}
      aria-label={fav ? "Bỏ yêu thích" : "Yêu thích"}
      className={cn(cls, fav && "text-danger")}
    >
      <Icon name="heart" className={cn("size-5", fav && "fill-current")} />
    </button>
  );
}
```

### Bước 3: Khối mua hàng, `frontend/src/components/product/BuyBox.tsx`

`useCartActions` ở bài 7.09; viết bài này xong thì làm tiếp bài sau rồi mới chạy thử.

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { ApiError } from "@/lib/api";
import { useCartActions } from "@/lib/cart";
import { cn } from "@/lib/cn";
import { DELIVERY } from "@/lib/shop";
import type { ProductDetail } from "@/lib/types";

import { FavoriteButton } from "./FavoriteButton";
import { Price } from "./Price";

// Khối mua hàng ở trang sản phẩm: chọn biến thể, số lượng, thêm vào giỏ / mua ngay.
export function BuyBox({ product: p }: { product: ProductDetail }) {
  const router = useRouter();
  const cart = useCartActions();
  // Mặc định chọn biến thể đầu tiên còn hàng
  const [variantId, setVariantId] = useState(
    () => (p.variants.find((v) => v.stock > 0) ?? p.variants[0])?.id,
  );
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");

  const variant = p.variants.find((v) => v.id === variantId);
  const maxQty = Math.min(variant?.stock ?? 0, 99);

  if (p.kind === "booking") {
    // Vé bay, tour: cần ngày đi, số khách, hạng dịch vụ; đặt chỗ làm ở Phần 08
    return (
      <div className="space-y-4">
        <Price
          price={p.price}
          oldPrice={p.old_price}
          prefix={p.tag === "ve-bay" ? "Giá/khách" : "Từ"}
          size="lg"
        />
        <p className="rounded-card-sm bg-surface-2 p-4 text-sm text-ink-2">
          Đặt vé, tour trực tuyến sắp ra mắt. Bạn có thể bấm yêu thích để lưu lại.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            disabled
            className="h-12 flex-1 rounded-full bg-ink font-semibold text-white opacity-50"
          >
            Đặt ngay
          </button>
          <FavoriteButton slug={p.slug} />
        </div>
      </div>
    );
  }

  const add = async (goToCart: boolean) => {
    if (!variant) return;
    setError("");
    try {
      await cart.add(variant.id, qty);
      if (goToCart) router.push("/gio-hang");
      else setAdded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thêm được vào giỏ, vui lòng thử lại");
    }
  };

  return (
    <div className="space-y-5">
      {variant && <Price price={variant.price} oldPrice={variant.old_price} size="lg" />}

      {p.variants.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Phân loại</legend>
          <div className="flex flex-wrap gap-2">
            {p.variants.map((v) => (
              <label
                key={v.id}
                className={cn(
                  "cursor-pointer rounded-card-sm px-4 py-2 text-sm font-semibold ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                  v.id === variantId
                    ? "bg-brand-50 text-brand-700 ring-brand-600"
                    : "ring-ink/[0.14] hover:ring-brand-300",
                  v.stock === 0 && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.id}
                  checked={v.id === variantId}
                  disabled={v.stock === 0}
                  onChange={() => {
                    setVariantId(v.id);
                    setQty(1);
                    setAdded(false);
                  }}
                  className="sr-only"
                />
                {v.label}
                {v.stock === 0 && " · Hết hàng"}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">Nhận hàng</p>
        <ul className="space-y-1.5 text-sm">
          {p.delivery_methods.map((m) => (
            <li key={m} className="flex gap-2">
              <Icon name="check" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <b className="font-semibold">{DELIVERY[m].label}</b>
                <span className="text-ink-muted"> · {DELIVERY[m].desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {variant && variant.stock > 0 ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Số lượng</span>
          <div className="flex items-center rounded-full ring-1 ring-ink/[0.14]">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Bớt một"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Icon name="minus" className="size-4" />
            </button>
            <span className="w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              aria-label="Thêm một"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Icon name="plus" className="size-4" />
            </button>
          </div>
          {variant.stock <= 10 && (
            <span className="text-sm text-accent-700">Chỉ còn {variant.stock}</span>
          )}
        </div>
      ) : (
        <p className="font-semibold text-danger">Sản phẩm tạm hết hàng</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void add(false)}
          disabled={!variant || variant.stock === 0 || cart.pending}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full font-semibold text-brand-700 ring-2 ring-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
        >
          <Icon name="cart" className="size-5" />
          Thêm vào giỏ
        </button>
        <button
          type="button"
          onClick={() => void add(true)}
          disabled={!variant || variant.stock === 0 || cart.pending}
          className="h-12 flex-1 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-50"
        >
          Mua ngay
        </button>
        <FavoriteButton slug={p.slug} />
      </div>
      {added && (
        <p className="text-sm text-success" role="status">
          Đã thêm vào giỏ.{" "}
          <Link href="/gio-hang" className="font-semibold underline">
            Xem giỏ hàng
          </Link>
        </p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

- **Biến thể mặc định là biến thể đầu tiên còn hàng**: gối cổ màu navy hết hàng thì chọn sẵn màu xám.
- **Đổi biến thể thì số lượng về 1**: tồn kho mỗi biến thể khác nhau.
- **Radio thật nằm trong nhãn, ẩn bằng `sr-only`**: bàn phím (mũi tên trái/phải) và trình đọc màn hình vẫn
  dùng được như radio bình thường; `has-[:focus-visible]:ring-2` vẽ viền khi radio bên trong được focus.
- **Vé, tour (`kind === "booking"`)**: chỉ hiện giá và nút "Đặt ngay" bị tắt; đặt chỗ ở Phần 08.

### Bước 4: Trang, `frontend/src/app/san-pham/[slug]/page.tsx`

```tsx
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
```

- **JSON-LD**: Google đọc khối `<script type="application/ld+json">` để hiện giá, số sao ngay trong kết
  quả tìm kiếm. `JSON.stringify` **không** escape `</script>`: tên sản phẩm có chuỗi đó sẽ đóng thẻ script
  sớm và chèn được HTML. Thay mọi `<` bằng `<` (JSON vẫn đọc ra đúng ký tự).
- **"Xem gian hàng"** trỏ `/kenh/<slug>#gian-hang` (bài 7.11).

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| http://localhost:3000/san-pham/nuoc-hoa-aviator-edp | 100ml chọn sẵn, 2.150.000₫, gạch 2.890.000₫, "-26%", "Chỉ còn 5" |
| Bấm "50ml" | Giá đổi 1.390.000₫, số lượng về 1 |
| Bấm ảnh nhỏ thứ 3 | Ảnh lớn đổi |
| `/san-pham/goi-co-memory-foam-du-lich` | "Xanh navy · Hết hàng" mờ, không chọn được; "Xám" chọn sẵn |
| `/san-pham/tour-nhat-ban-mua-la-do-5n4d` | "Từ 18.900.000₫", nút "Đặt ngay" bị tắt |
| Khách bấm trái tim | Sang đăng nhập, quay lại đúng trang |
| Xem nguồn trang (Ctrl+U), tìm `ld+json` | Có khối JSON `"@type":"Product"` |
| Console | Không có cảnh báo LCP |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Vẫn cảnh báo LCP dù ảnh lớn đã `loading="eager"` | Có ảnh khác **cùng địa chỉ** đang `lazy` (ảnh nhỏ của bộ ảnh, ảnh trong giỏ) |
| Bấm Tab không tới được các ô biến thể | Ẩn radio bằng `display: none` / `hidden`; phải dùng `sr-only` |
