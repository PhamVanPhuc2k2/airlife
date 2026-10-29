# Bài 7.07: Frontend: thẻ sản phẩm, trang Kinh doanh và Tour bay

> [← Bài trước](06-noi-route-va-thu-api.md) · [Mục lục](../README.md) · [Bài sau →](08-trang-san-pham.md)

## Mục tiêu

- Kiểu dữ liệu, định dạng giá, truy vấn cho bán hàng.
- Trang `/kinh-doanh`, `/tour-bay`: chip lọc, sắp "Mới nhất / Bán chạy", lưới sản phẩm cuộn tải thêm.
- Bỏ thuộc tính `priority` của `next/image` (Next.js 16 coi là lỗi thời).

## Bạn sẽ học

- Dùng lại component bằng cách đưa phần khác nhau thành tham số (`FilterChips` nhận `sorts`).
- Định dạng tiền Việt Nam bằng `toLocaleString("vi-VN")`.
- `loading="eager"` và `fetchPriority="high"` cho ảnh ở màn hình đầu.

## Viết code

### Bước 1: Kiểu, định dạng, truy vấn

Thêm vào cuối `frontend/src/lib/types.ts` (cùng `shop: ProductCard[]` trong `Home`, `orders` trong
`LibraryStats`). Bản đầy đủ:

```ts
// Kiểu dữ liệu API trả về. Khớp với DTO bên Go (backend/internal/media/dto.go,
// internal/category, internal/home). Đổi bên Go thì sửa ở đây.

export type Category = {
  slug: string;
  name: string;
  icon: string;
  title: string;
  description: string;
  filters?: { slug: string; name: string }[];
};

export type Channel = {
  slug: string;
  name: string;
  verified: boolean;
  followers_count?: number;
};

export type MediaCard = {
  id: string;
  slug: string;
  kind: "video" | "audio";
  category: string;
  title: string;
  description?: string;
  group_label: string;
  genre_label: string;
  youtube_id: string | null;
  thumbnail_url: string;
  duration_seconds: number | null;
  episode_count: number | null;
  view_count: number;
  featured: boolean;
  published_at: string;
  channel: Channel;
};

export type MediaDetail = MediaCard & {
  tags: string[];
  category_name: string;
  lineup_month: string | null;
};

export type MediaPage = {
  items: MediaCard[];
  next_cursor?: string;
};

export type Home = {
  featured: MediaCard | null;
  latest: MediaCard[];
  trending: MediaCard[];
  top_listen: MediaCard[];
  hot_comments: { top: HotComment[]; replied: HotComment[] };
  shop: ProductCard[];
};

export type NewsCategory = {
  slug: string;
  name: string;
  description: string;
};

export type NewsCard = {
  id: string;
  slug: string;
  category: string;
  category_name: string;
  title: string;
  excerpt: string;
  cover_url: string;
  author: string;
  published_at: string;
};

// body_html đã được backend lọc bằng bluemonday trước khi lưu (backend/pkg/sanitize)
export type Article = NewsCard & {
  body_html: string;
  updated_at: string;
};

export type NewsPage = {
  items: NewsCard[];
  next_cursor?: string;
};

// Tài khoản đang đăng nhập (GET /auth/me). Khớp backend/internal/auth/service.go: User
export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "creator" | "business" | "editor" | "admin";
  email_verified: boolean;
  created_at: string;
};

// Trang kênh (GET /channels/{slug}). following: người đang xem có theo dõi không
export type ChannelDetail = {
  slug: string;
  name: string;
  type: "distributor" | "creator" | "business" | "travel";
  verified: boolean;
  followers_count: number;
  description: string;
  avatar_url: string | null;
  media_count: number;
  following: boolean;
};

// Kênh trong danh sách "Kênh đang theo dõi" (GET /me/following)
export type ChannelBrief = {
  slug: string;
  name: string;
  type: ChannelDetail["type"];
  verified: boolean;
  followers_count: number;
  avatar_url: string | null;
};

export type Comment = {
  id: string;
  author: { id: string; display_name: string; avatar_url: string | null };
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  liked_by_me: boolean;
  mine: boolean;
};

export type CommentPage = { items: Comment[]; next_cursor?: string };

export type HotComment = Comment & { media: { slug: string; category: string; title: string } };

// Thư viện cá nhân (Phần 06) ------------------------------------------------------------------

// Đã xem tới giây thứ position trên tổng duration giây
export type Progress = { position: number; duration: number };

// Media trong thư viện. progress chỉ có ở lịch sử xem / tiếp tục xem
export type LibraryItem = MediaCard & { progress?: Progress };

export type LibraryPage = { items: LibraryItem[]; next_cursor?: string };

// GET /me/media/{slug}: trạng thái của một media với người đang xem
export type MediaState = { saved: boolean; progress: Progress | null; playlist_ids: string[] };

export type LibraryStats = {
  following: number;
  saved: number;
  playlists: number;
  watched: number;
  orders: number;
};

export type Playlist = {
  id: string;
  name: string;
  item_count: number;
  updated_at: string;
  first?: { slug: string; category: string; thumbnail_url: string };
};

export type PlaylistDetail = Playlist & { items: LibraryItem[] };

// Bán hàng (Phần 07) ---------------------------------------------------------------------------
// Tiền là số nguyên, đơn vị đồng (389000 = 389.000₫)

export type DeliveryMethod = "gate" | "arrival" | "home" | "evoucher";

export type ProductCard = {
  id: string;
  slug: string;
  kind: "goods" | "booking"; // booking: vé bay, tour (đặt chỗ ở Phần 08)
  category: string;
  tag: string;
  tag_name: string;
  name: string;
  description: string;
  image_url: string;
  price: number; // giá thấp nhất ("từ")
  old_price: number | null;
  rating: number;
  rating_count: number;
  sold_count: number;
  published_at: string;
  channel: {
    slug: string;
    name: string;
    verified: boolean;
    type?: string;
    followers_count?: number;
  };
};

export type ProductVariant = {
  id: string;
  label: string;
  price: number;
  old_price: number | null;
  stock: number;
};

export type ProductDetail = ProductCard & {
  category_name: string;
  body_html: string;
  gallery: string[];
  delivery_methods: DeliveryMethod[];
  variants: ProductVariant[];
  media: MediaCard[];
  related: ProductCard[];
};

export type ProductPage = { items: ProductCard[]; next_cursor?: string };

export type CartLine = {
  variant_id: string;
  quantity: number;
  label: string;
  price: number;
  old_price: number | null;
  stock: number;
  product: { slug: string; name: string; image_url: string; channel_name: string };
  delivery_methods: DeliveryMethod[];
  problem?: "unavailable" | "out_of_stock" | "low_stock";
};

export type Cart = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  delivery_methods: DeliveryMethod[]; // cách nhận dùng được cho cả giỏ
  ready: boolean;
};

export type OrderStatus = "pending" | "confirmed" | "delivering" | "completed" | "cancelled";

export type Order = {
  code: string;
  status: OrderStatus;
  payment_method: "cod";
  delivery_method: DeliveryMethod;
  recipient_name: string;
  phone: string;
  flight_code: string | null;
  flight_date: string | null;
  address: string | null;
  note: string;
  subtotal: number;
  shipping_fee: number;
  total: number;
  created_at: string;
  cancelled_at: string | null;
  items: {
    product_slug: string;
    product_name: string;
    variant_label: string;
    image_url: string;
    unit_price: number;
    quantity: number;
    line_total: number;
  }[];
};

export type OrderSummary = {
  code: string;
  status: OrderStatus;
  delivery_method: DeliveryMethod;
  total: number;
  created_at: string;
  first_name: string;
  first_image: string;
  item_count: number;
};

export type OrderPage = { items: OrderSummary[]; next_cursor?: string };
```

Thêm vào cuối `frontend/src/lib/format.ts`:

```ts
// 389000 → "389.000₫"
export function formatPrice(n: number): string {
  return `${n.toLocaleString("vi-VN")}₫`;
}

// Phần trăm giảm: giá 389.000, giá cũ 450.000 → 14
export function discountPercent(price: number, oldPrice: number | null): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round((1 - price / oldPrice) * 100);
}
```

`frontend/src/lib/queries.ts` thêm `productListOptions`, `favoritesOptions`, `ordersOptions`. Bản đầy đủ:

```ts
import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type {
  CommentPage,
  LibraryPage,
  MediaPage,
  NewsPage,
  OrderPage,
  ProductPage,
} from "./types";

// Mỗi truy vấn khai báo một lần (key + hàm lấy dữ liệu) bằng infiniteQueryOptions, dùng chung
// cho server (prefetch) và client (useInfiniteQuery). Key giống nhau thì client nhận lại đúng
// dữ liệu server đã lấy.

export type MediaListParams = {
  category?: string; // bỏ trống = mọi chuyên mục (trang Mới tải)
  tag?: string;
  channel?: string; // trang kênh
  sort?: "new" | "popular";
};

export function mediaListOptions(p: MediaListParams) {
  return infiniteQueryOptions({
    queryKey: ["media", "list", p.category ?? "", p.tag ?? "", p.channel ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<MediaPage>(
        `/media?${qs({ category: p.category, tag: p.tag, channel: p.channel, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal }, // rời trang giữa chừng thì huỷ request
      ),
    initialPageParam: "",
    // next_cursor rỗng → undefined → TanStack hiểu là hết trang
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function newsListOptions(category?: string) {
  return infiniteQueryOptions({
    queryKey: ["news", "list", category ?? ""],
    queryFn: ({ pageParam, signal }) =>
      api<NewsPage>(`/news?${qs({ category, cursor: pageParam, limit: 12 })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export type CommentTarget = { kind: "media" | "news"; slug: string };

// Bình luận của một media/bài viết. Lấy ở trình duyệt (có cookie) vì kèm liked_by_me, mine.
export function commentsOptions(t: CommentTarget, sort: "top" | "new") {
  return infiniteQueryOptions({
    queryKey: ["comments", t.kind, t.slug, sort],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/${t.kind}/${t.slug}/comments?${qs({ sort, cursor: pageParam })}`, {
        signal,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function repliesOptions(commentId: string) {
  return infiniteQueryOptions({
    queryKey: ["comments", "replies", commentId],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/comments/${commentId}/replies?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

// Lịch sử xem / đã lưu của người đang đăng nhập. Key bắt đầu bằng "me": đăng xuất thì
// useLogout xoá sạch cache, không để lộ cho người dùng sau trên cùng máy.
export function libraryListOptions(list: "history" | "saved") {
  return infiniteQueryOptions({
    queryKey: ["me", list],
    queryFn: ({ pageParam, signal }) =>
      api<LibraryPage>(`/me/${list}?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export type ProductListParams = {
  category?: string; // kinh-doanh | tour-bay
  tag?: string;
  channel?: string; // gian hàng của một kênh
  sort?: "new" | "bestseller";
};

export function productListOptions(p: ProductListParams) {
  return infiniteQueryOptions({
    queryKey: ["products", "list", p.category ?? "", p.tag ?? "", p.channel ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<ProductPage>(
        `/products?${qs({ category: p.category, tag: p.tag, channel: p.channel, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function favoritesOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "favorites"],
    queryFn: ({ pageParam, signal }) =>
      api<ProductPage>(`/me/favorites?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function ordersOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "orders"],
    queryFn: ({ pageParam, signal }) =>
      api<OrderPage>(`/me/orders?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

Tên và mô tả cách nhận hàng, trạng thái đơn dùng ở nhiều trang, `frontend/src/lib/shop.ts`:

```ts
import type { DeliveryMethod, OrderStatus } from "./types";

// Tên và mô tả cách nhận hàng (mockup: trang sản phẩm, "Nhận hàng"). Cùng khoá với backend
// (internal/order: DeliveryLabel).
export const DELIVERY: Record<DeliveryMethod, { label: string; desc: string }> = {
  gate: {
    label: "Nhận tại cửa ra máy bay",
    desc: "Đặt trước giờ bay, nhận ngay trước khi lên máy bay",
  },
  arrival: { label: "Giao tại sân bay đến", desc: "Nhân viên chờ ở sảnh đến" },
  home: { label: "Giao tận nhà", desc: "2–3 ngày, miễn phí cho đơn từ 300.000₫" },
  evoucher: { label: "Nhận mã qua email", desc: "Mã điện tử dùng tại quầy dịch vụ" },
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  pending: { label: "Chờ xác nhận", tone: "bg-warning/15 text-accent-800" },
  confirmed: { label: "Đã xác nhận", tone: "bg-brand-50 text-brand-700" },
  delivering: { label: "Đang giao", tone: "bg-brand-50 text-brand-700" },
  completed: { label: "Đã nhận hàng", tone: "bg-success/15 text-success" },
  cancelled: { label: "Đã huỷ", tone: "bg-surface-2 text-ink-muted" },
};

// Phí giao: cùng quy tắc với backend (chỉ để hiện trước; số cuối cùng do server tính)
export const HOME_SHIPPING_FEE = 30_000;
export const FREE_SHIPPING_FROM = 300_000;
```

### Bước 2: Icon

Thêm vào `LINE_ICONS` trong `frontend/src/components/icons/Icon.tsx`, sau `pencil`:

```tsx
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  minus: <path d="M5 12h14" />,
```

### Bước 3: Giá và thẻ sản phẩm

`frontend/src/components/product/Price.tsx`:

```tsx
import { cn } from "@/lib/cn";
import { discountPercent, formatPrice } from "@/lib/format";

// Giá bán, giá cũ gạch ngang, nhãn % giảm (mockup: .price)
export function Price({
  price,
  oldPrice,
  prefix,
  size = "md",
}: {
  price: number;
  oldPrice: number | null;
  prefix?: string; // "Từ", "Giá/khách"
  size?: "md" | "lg";
}) {
  const off = discountPercent(price, oldPrice);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {prefix && <small className="text-sm text-ink-muted">{prefix}</small>}
      <strong className={cn("font-bold text-accent-700", size === "lg" ? "text-3xl" : "text-lg")}>
        {formatPrice(price)}
      </strong>
      {off > 0 && oldPrice && (
        <>
          <del className="text-sm text-ink-muted">{formatPrice(oldPrice)}</del>
          <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-xs font-bold text-danger">
            -{off}%
          </span>
        </>
      )}
    </p>
  );
}
```

`frontend/src/components/product/ProductCard.tsx`:

```tsx
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
```

`eager`: 4 thẻ đầu tải ảnh ngay, các thẻ sau chờ cuộn tới (`loading="lazy"`).

### Bước 4: `priority` → `loading="eager"`

Next.js 16 coi `priority` của `next/image` là lỗi thời; tài liệu (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`)
khuyên dùng `loading="eager"` hoặc `fetchPriority="high"`. Đổi các chỗ cũ:

- `MediaCard`: prop `priority` thành `eager`, truyền `loading={eager ? "eager" : "lazy"}`; `MediaGrid` truyền
  `eager={i < 4}`.
- `FeaturedHero`, `ArticlePage`, `NewsLead` (ảnh lớn nhất màn hình đầu): thay `priority` bằng
  `loading="eager"` và `fetchPriority="high"`.

Bản đầy đủ `frontend/src/components/media/MediaCard.tsx`:

```tsx
import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard as Media, Progress } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Thẻ media trong lưới (trang chủ, chuyên mục). Ảnh 16:9, nhãn thời lượng góc dưới phải,
// avatar kênh + tiêu đề + "1,1 Tr lượt xem · 2 tuần trước" như mockup.
// progress (lịch sử xem): vạch đỏ ở đáy ảnh cho biết đã xem tới đâu. action: nút thêm ở góc
// phải (vd. "Bỏ khỏi lịch sử"), do nơi dùng truyền vào.
export function MediaCard({
  media,
  eager = false,
  progress,
  action,
}: {
  media: Media;
  eager?: boolean; // thẻ ở màn hình đầu: tải ảnh ngay, không chờ cuộn tới
  progress?: Progress;
  action?: React.ReactNode;
}) {
  const href = mediaHref(media);
  const duration = durationLabel(media);
  return (
    <article className="group">
      <Link href={href} className="block" tabIndex={-1} aria-hidden="true">
        <div className="relative aspect-video overflow-hidden rounded-card bg-surface-3">
          <Image
            src={media.thumbnail_url}
            alt=""
            fill
            loading={eager ? "eager" : "lazy"}
            // Trình duyệt chọn cỡ ảnh vừa đủ theo bề rộng thẻ trên từng màn hình
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
          />
          {duration && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
              {duration}
            </span>
          )}
          {progress && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/40">
              <span
                className="block h-full bg-danger"
                style={{
                  width: `${Math.min(100, (progress.position / progress.duration) * 100)}%`,
                }}
              />
            </span>
          )}
        </div>
      </Link>
      <div className="mt-3 flex gap-3">
        <Avatar name={media.channel.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link href={href} className="hover:text-brand-700">
              {media.title}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
            <Link href={`/kenh/${media.channel.slug}`} className="hover:text-ink">
              {media.channel.name}
            </Link>
            {media.channel.verified && (
              <span title="Kênh đã xác minh">
                <Icon name="check" className="size-3.5 text-brand-600" />
                <span className="sr-only">(đã xác minh)</span>
              </span>
            )}
          </p>
          <p className="text-sm text-ink-muted">
            {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
            {/* Server và trình duyệt tính "x phút trước" ở hai thời điểm khác nhau một chút */}
            <time dateTime={media.published_at} suppressHydrationWarning>
              {timeAgo(media.published_at)}
            </time>
          </p>
        </div>
        {action}
      </div>
    </article>
  );
}
```

### Bước 5: Chip lọc dùng chung, `frontend/src/components/category/FilterChips.tsx`

Bản cũ ghi cứng hai nút "Mới nhất / Xem nhiều". Sản phẩm cần "Mới nhất / Bán chạy", nên đưa danh sách
cách sắp xếp thành tham số `sorts`; cách đầu tiên là mặc định (không ghi lên URL):

```tsx
import Link from "next/link";

import { ChipLinks } from "@/components/ui/ChipLinks";
import { qs } from "@/lib/api";
import { cn } from "@/lib/cn";

type Props = {
  basePath: string; // "/xem"
  filters: { slug: string; name: string }[];
  activeTag?: string;
  // Các cách sắp xếp; cách đầu tiên là mặc định (không ghi lên URL)
  sorts: readonly { value: string; label: string }[];
  sort: string;
};

// Chip lọc và nút sắp xếp đều là LINK (?f=…&sort=…), không phải nút đổi state:
// - Dán link cho người khác là họ thấy đúng bộ lọc.
// - Bấm "quay lại" của trình duyệt là về bộ lọc trước.
// - Server đọc tham số URL, lấy sẵn dữ liệu đúng bộ lọc.
export function FilterChips({ basePath, filters, activeTag, sorts, sort }: Props) {
  const href = (tag?: string, s: string = sort) => {
    const q = qs({ f: tag, sort: s === sorts[0]?.value ? undefined : s });
    return q ? `${basePath}?${q}` : basePath;
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ChipLinks
        items={[
          { href: href(undefined), label: "Tất cả", active: !activeTag },
          ...filters.map((f) => ({
            href: href(f.slug),
            label: f.name,
            active: activeTag === f.slug,
          })),
        ]}
      />
      <div className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold">
        {sorts.map((s) => (
          <Link
            key={s.value}
            href={href(activeTag, s.value)}
            aria-current={sort === s.value ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5",
              sort === s.value
                ? "bg-surface text-brand-700 shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

`CategoryPage` (Xem, Nghe) khai báo `SORTS` của nó và truyền `sorts={SORTS}`. Bản đầy đủ:

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { mediaListOptions } from "@/lib/queries";
import type { Category } from "@/lib/types";

import { FilterChips } from "./FilterChips";
import { MediaGrid } from "./MediaGrid";

const SORTS = [
  { value: "new", label: "Mới nhất" },
  { value: "popular", label: "Xem nhiều" },
] as const;

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
        sorts={SORTS}
        sort={sort}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <MediaGrid category={slug} tag={tag} sort={sort} />
      </HydrationBoundary>
    </div>
  );
}
```

### Bước 6: Lưới và trang chuyên mục

`frontend/src/components/product/ProductGrid.tsx`:

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { LoadMore } from "@/components/ui/LoadMore";
import { type ProductListParams, productListOptions } from "@/lib/queries";

import { ProductCard } from "./ProductCard";

// Lưới sản phẩm cuộn tải thêm (như MediaGrid, bài 2.11)
export function ProductGrid(params: ProductListParams & { empty?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    productListOptions(params),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (data && items.length === 0) {
    return (
      <p className="py-16 text-center text-ink-muted">
        {params.empty ?? "Chưa có sản phẩm nào trong mục này."}
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((p, i) => (
          <ProductCard key={p.id} product={p} eager={i < 4} />
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

`frontend/src/components/product/ProductCategoryPage.tsx`:

```tsx
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
```

`frontend/src/app/kinh-doanh/page.tsx` (và `tour-bay/page.tsx` giống hệt, đổi `slug`, `title`):

```tsx
import type { Metadata } from "next";

import { ProductCategoryPage } from "@/components/product/ProductCategoryPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kinh doanh" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page({ searchParams }: Props) {
  return <ProductCategoryPage slug="kinh-doanh" searchParams={searchParams} />;
}
```

Sửa link "Combo bay + khách sạn" trong `frontend/src/config/nav.ts`: `?f=combo` thành
`?f=combo-bay-khach-san` (đúng slug chip lọc trong database).

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Mở http://localhost:3000/kinh-doanh | 10 thẻ: ảnh vuông, nhãn "-13%", loại, tên, sao, đã bán, giá |
| Bấm chip "Miễn thuế" | Nước hoa, đồng hồ; URL `?f=mien-thue` |
| Bấm "Bán chạy" | URL thêm `&sort=bestseller` |
| `/tour-bay?f=combo-bay-khach-san` | Hai combo, giá có chữ "Từ" |
| Trang Xem, Nghe | Vẫn "Mới nhất / Xem nhiều" như cũ |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trang báo `{imported module ./src/lib/queries.ts}.productListOptions is not a function` dù code đúng | Turbopack còn giữ bản cũ của module (đã gặp ở Phần 01). `make restart s=frontend` |
| Console: `Image with src "…" was detected as the Largest Contentful Paint (LCP). Please add the loading="eager"` | Ảnh ở màn hình đầu đang tải lười. Thêm `loading="eager"` (xem bài 7.08 cho một trường hợp khó thấy hơn) |
| Bấm chip "Combo" ra trang trống | Link dùng `?f=combo`, slug thật là `combo-bay-khach-san` |
