# Bài 8.05: Frontend: chọn ngày, hạng, số khách ở trang vé và tour

> [← Bài trước](04-tra-cho-va-thu-api.md) · [Mục lục](../README.md) · [Bài sau →](06-trang-giu-cho-va-nghiem-thu.md)

## Mục tiêu

Thay khối "Đặt ngay" bị tắt ở Phần 07 bằng khối đặt chỗ thật: hàng ngày khởi hành vuốt ngang, hạng dịch vụ
kèm số chỗ còn, số người lớn / trẻ em, tổng tiền, "Đặt ngay" giữ chỗ rồi sang trang điền hành khách.

## Bạn sẽ học

- Khoá chống trùng theo **lựa chọn** (đổi lựa chọn là khoá mới) bằng `useRef`.
- Ba nguyên nhân làm trang bị cuộn ngang và cách tìm ra chúng.
- Dữ liệu thay đổi liên tục (số chỗ) thì lấy ở trình duyệt, `staleTime` ngắn.

## Viết code

### Bước 1: Kiểu, nhãn, truy vấn

Thêm vào cuối `frontend/src/lib/types.ts` (`Fare`, `Departure`, `Availability`, `Booking`…). Bản đầy đủ:

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

// Đặt vé, tour (Phần 08) -----------------------------------------------------------------------

export type Fare = {
  id: string;
  code: string;
  label: string;
  description: string;
  adult_price: number;
  child_price: number;
};

export type Departure = {
  id: string;
  depart_date: string; // "2026-11-14"
  return_date: string | null;
  seats: { fare_id: string; left: number }[];
};

export type Availability = { fares: Fare[]; departures: Departure[] };

export type BookingStatus = "held" | "awaiting_payment" | "confirmed" | "cancelled" | "expired";

export type Booking = {
  code: string;
  status: BookingStatus;
  expires_at: string;
  expires_in: number; // giây giữ chỗ còn lại, server tính
  product: { slug: string; name: string; tag: string; image_url: string };
  fare_label: string;
  depart_date: string;
  return_date: string | null;
  adults: number;
  children: number;
  adult_price: number;
  child_price: number;
  total: number;
  contact: { name: string; phone: string; email: string } | null;
  passengers: { kind: "adult" | "child"; full_name: string; birth_date: string }[];
  created_at: string;
};

export type BookingSummary = {
  code: string;
  status: BookingStatus;
  expires_at: string;
  product_name: string;
  product_image: string;
  fare_label: string;
  depart_date: string;
  adults: number;
  children: number;
  total: number;
  created_at: string;
};

export type BookingPage = { items: BookingSummary[]; next_cursor?: string };
```

`frontend/src/lib/shop.ts` thêm `BOOKING_STATUS`, `passportName` (xem trước tên in trên vé, cùng cách với
backend: `normalize("NFD")` rồi xoá `\p{Mn}`), `shortDate`. Bản đầy đủ:

```ts
import type { BookingStatus, DeliveryMethod, OrderStatus } from "./types";

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

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  held: { label: "Đang giữ chỗ", tone: "bg-warning/15 text-accent-800" },
  awaiting_payment: { label: "Chờ thanh toán", tone: "bg-warning/15 text-accent-800" },
  confirmed: { label: "Đã xác nhận", tone: "bg-success/15 text-success" },
  cancelled: { label: "Đã huỷ", tone: "bg-surface-2 text-ink-muted" },
  expired: { label: "Hết hạn giữ chỗ", tone: "bg-surface-2 text-ink-muted" },
};

// "Nguyễn Văn  Đức" → "NGUYEN VAN DUC", giống backend (booking.PassportName): xem trước tên in
// trên vé. NFD tách chữ và dấu; \p{Mn} là các dấu; "đ" không phải "d" có dấu nên đổi tay.
export function passportName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

// "2026-11-14" → "T7, 14/11" (thứ theo giờ Việt Nam)
export function shortDate(d: string): string {
  return new Date(`${d}T00:00:00+07:00`).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
```

`frontend/src/lib/queries.ts` thêm `bookingsOptions` (key `["me", "bookings"]`). Bản đầy đủ:

```ts
import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type {
  BookingPage,
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

export function bookingsOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "bookings"],
    queryFn: ({ pageParam, signal }) =>
      api<BookingPage>(`/me/bookings?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

### Bước 2: `frontend/src/components/booking/BookingBox.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { FavoriteButton } from "@/components/product/FavoriteButton";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { shortDate } from "@/lib/shop";
import type { Availability, Booking, ProductDetail } from "@/lib/types";

const MAX_PAX = 9;

// Khối đặt vé, tour ở trang sản phẩm (mockup: ngày bay, số khách, hạng dịch vụ). Bấm "Đặt ngay"
// là GIỮ CHỖ 20 phút rồi sang trang điền hành khách.
export function BookingBox({ product: p }: { product: ProductDetail }) {
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const key = ["products", p.slug, "departures"];
  // Số chỗ thay đổi liên tục nên lấy ở trình duyệt, không dựng sẵn ở server
  const { data, isPending } = useQuery({
    queryKey: key,
    queryFn: () => api<Availability>(`/products/${p.slug}/departures`),
    staleTime: 30_000,
  });

  const [departureId, setDepartureId] = useState<string>();
  const [fareId, setFareId] = useState<string>();
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  // Khoá chống giữ chỗ trùng: một khoá cho một lựa chọn. Đổi ngày, hạng, số khách thì bỏ khoá cũ
  // (lần bấm sau là một đơn mới); bấm hai lần với cùng lựa chọn thì dùng lại khoá (một đơn).
  const keyRef = useRef<string | null>(null);
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      keyRef.current = null;
      set(v);
    };

  const departures = data?.departures ?? [];
  const departure = departures.find((d) => d.id === departureId) ?? departures[0];
  const fares = data?.fares ?? [];
  const seatsOf = (id: string) => departure?.seats.find((s) => s.fare_id === id)?.left ?? 0;
  const fare =
    fares.find((f) => f.id === fareId && seatsOf(f.id) > 0) ?? fares.find((f) => seatsOf(f.id) > 0);
  const left = fare ? seatsOf(fare.id) : 0;
  const pax = adults + children;
  const total = fare ? fare.adult_price * adults + fare.child_price * children : 0;
  const isFlight = p.tag === "ve-bay";

  const hold = useMutation({
    mutationFn: () => {
      keyRef.current ??= crypto.randomUUID();
      return api<Booking>("/me/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: JSON.stringify({ departure_id: departure?.id, fare_id: fare?.id, adults, children }),
      });
    },
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["me", "bookings"] });
      router.push(`/dat-cho/${b.code}`);
    },
    onError: (err) => {
      // Vừa có người giữ mất chỗ: tải lại số chỗ
      if (err instanceof ApiError && ["sold_out", "not_enough_seats"].includes(err.code)) {
        keyRef.current = null;
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  if (isPending) return <div className="h-72 animate-pulse rounded-card bg-surface-2" />;
  if (!departure || !data) {
    return (
      <p className="rounded-card-sm bg-surface-2 p-4 text-ink-2">Hiện chưa có lịch khởi hành.</p>
    );
  }

  const error = hold.error instanceof ApiError ? hold.error : null;
  return (
    <div className="space-y-5">
      {/* min-w-0: <fieldset> mặc định có min-width: min-content, hàng ngày cuộn ngang bên trong sẽ
          đẩy cả trang rộng ra (thanh cuộn ngang) thay vì tự cuộn */}
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold">
          {isFlight ? "Ngày bay" : "Ngày khởi hành"}
        </legend>
        {/* Vuốt ngang qua các ngày; mỗi ngày ghi số chỗ còn của hạng rẻ nhất */}
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {departures.map((d) => {
            const total = d.seats.reduce((n, s) => n + s.left, 0);
            return (
              <label
                key={d.id}
                className={cn(
                  // relative: radio ẩn (sr-only = position absolute) phải nằm TRONG ô này. Không có thì nó
                  // bám vào khối cha ngoài vùng cuộn, 30 radio của 30 ngày kéo cả trang rộng ra.
                  "relative shrink-0 cursor-pointer snap-start rounded-card-sm px-3 py-2 text-center ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                  d.id === departure.id
                    ? "bg-brand-50 text-brand-700 ring-brand-600"
                    : "ring-ink/[0.14] hover:ring-brand-300",
                  total === 0 && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="departure"
                  className="sr-only"
                  checked={d.id === departure.id}
                  disabled={total === 0}
                  onChange={() => change(setDepartureId)(d.id)}
                />
                <b className="block text-sm">{shortDate(d.depart_date)}</b>
                <small className="text-xs text-ink-muted">
                  {total === 0
                    ? "Hết chỗ"
                    : d.return_date
                      ? `Về ${shortDate(d.return_date).split(", ")[1]}`
                      : "Một chiều"}
                </small>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Hạng dịch vụ</legend>
        {fares.map((f) => {
          const n = seatsOf(f.id);
          return (
            <label
              key={f.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-card-sm p-3 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                f.id === fare?.id
                  ? "bg-brand-50 ring-brand-600"
                  : "ring-ink/[0.14] hover:ring-brand-300",
                n === 0 && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="fare"
                className="mt-1 accent-brand-600"
                checked={f.id === fare?.id}
                disabled={n === 0}
                onChange={() => change(setFareId)(f.id)}
              />
              <span className="min-w-0 flex-1">
                <b className="block font-semibold">{f.label}</b>
                <span className="text-sm text-ink-muted">{f.description}</span>
              </span>
              <span className="text-right text-sm">
                <b className="block text-accent-700">{formatPrice(f.adult_price)}</b>
                <span
                  className={cn("text-xs", n > 0 && n <= 5 ? "text-accent-700" : "text-ink-muted")}
                >
                  {n === 0 ? "Hết chỗ" : `Còn ${n} chỗ`}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stepper
          label="Người lớn"
          hint="Từ 12 tuổi"
          value={adults}
          min={1}
          max={Math.min(MAX_PAX - children, left - children)}
          onChange={change(setAdults)}
        />
        <Stepper
          label="Trẻ em"
          hint={fare ? `2–11 tuổi · ${formatPrice(fare.child_price)}` : "2–11 tuổi"}
          value={children}
          min={0}
          max={Math.min(MAX_PAX - adults, left - adults)}
          onChange={change(setChildren)}
        />
      </div>

      <p className="flex items-baseline justify-between border-t border-ink/[0.07] pt-4">
        <span className="text-ink-muted">Tổng cộng ({pax} khách)</span>
        <strong className="text-2xl font-bold text-accent-700">{formatPrice(total)}</strong>
      </p>

      {error && (
        <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
          {error.message}
          {error.code === "too_many_holds" && (
            <>
              {" "}
              <Link href="/dat-cho" className="font-semibold underline">
                Xem đơn đang giữ
              </Link>
            </>
          )}
          {error.code === "email_not_verified" && (
            <>
              {" "}
              <Link href="/ban" className="font-semibold underline">
                Xác minh email
              </Link>
            </>
          )}
        </p>
      )}

      <div className="flex gap-3">
        {me ? (
          <button
            type="button"
            onClick={() => hold.mutate()}
            disabled={!fare || pax > left || hold.isPending}
            className="h-12 flex-1 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-50"
          >
            {hold.isPending ? "Đang giữ chỗ…" : "Đặt ngay"}
          </button>
        ) : (
          <Link
            href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
            className="flex h-12 flex-1 items-center justify-center rounded-full bg-gradient-brand font-semibold text-white shadow-brand"
          >
            Đăng nhập để đặt
          </Link>
        )}
        <FavoriteButton slug={p.slug} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon name="history" className="size-4" />
        Bấm “Đặt ngay” để giữ chỗ trong 20 phút trong lúc điền thông tin hành khách.
      </p>
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card-sm p-3 ring-1 ring-ink/[0.14]">
      <span>
        <b className="block text-sm font-semibold">{label}</b>
        <small className="text-xs text-ink-muted">{hint}</small>
      </span>
      <span className="flex items-center">
        <button
          type="button"
          aria-label={`Bớt ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex size-9 items-center justify-center rounded-full ring-1 ring-ink/[0.14] disabled:opacity-40"
        >
          <Icon name="minus" className="size-4" />
        </button>
        <span className="w-8 text-center font-semibold" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Thêm ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex size-9 items-center justify-center rounded-full ring-1 ring-ink/[0.14] disabled:opacity-40"
        >
          <Icon name="plus" className="size-4" />
        </button>
      </span>
    </div>
  );
}
```

- **Khoá chống trùng**: hàng hoá dùng một khoá cho cả trang thanh toán (bài 7.10). Ở đây khách có thể giữ
  chỗ, quay lại, đổi ngày rồi giữ tiếp: nếu dùng chung khoá, server trả lại đơn cũ. `keyRef` được xoá mỗi
  khi đổi lựa chọn (hàm `change`), và chỉ sinh khi bấm (`??=`). Ref đọc/ghi trong hàm xử lý sự kiện là hợp
  lệ (khác lúc render, bài 6.03).
- **Hạng mặc định**: hạng đang chọn nếu ngày mới còn chỗ hạng đó, không thì hạng đầu tiên còn chỗ.
- **Giới hạn bước tăng**: số khách không vượt 9 và không vượt số chỗ còn của hạng.
- **Hết chỗ / không đủ chỗ**: tải lại số chỗ và bỏ khoá để lần bấm sau là yêu cầu mới.

Trong `frontend/src/components/product/BuyBox.tsx`, khối `if (p.kind === "booking") { … }` của Phần 07
thay bằng:

```tsx
  if (p.kind === "booking") return <BookingBox product={p} />;
```

### Bước 3: Ba lỗi cuộn ngang

Chụp trang vé máy bay thấy thanh cuộn ngang ở đáy trang. Cách tìm: đo `document.documentElement.scrollWidth`
so với `clientWidth`, rồi liệt kê phần tử có cạnh phải vượt khung nhìn (trong DevTools Console):

```js
[...document.querySelectorAll("main *")]
  .map((el) => [Math.round(el.getBoundingClientRect().right), el])
  .filter(([r]) => r > document.documentElement.clientWidth)
  .sort((a, b) => b[0] - a[0])
  .slice(0, 8);
```

Lần lượt tìm ra:

1. **`<fieldset>` có `min-width: min-content` mặc định**: hàng ngày vuốt ngang nằm trong fieldset, fieldset
   nở theo nội dung thay vì co lại cho hàng tự cuộn. Thêm `min-w-0`.
2. **Radio ẩn `sr-only` là `position: absolute`**: nhãn bọc ngoài không có `relative`, radio bám vào một
   khối cha nằm ngoài vùng cuộn; 30 radio của 30 ngày kéo trang rộng tới 4261px. Thêm `relative` cho nhãn
   (sửa luôn ô biến thể trong `BuyBox`).
3. **Lưới không khai báo cột trên điện thoại**: `grid gap-8 lg:grid-cols-[…]` ở màn nhỏ không có cột nào
   được khai báo, lưới tự tạo cột rộng theo nội dung. Thêm `grid-cols-1` (`minmax(0, 1fr)`) cho hai lưới
   trong `frontend/src/app/san-pham/[slug]/page.tsx`. Cùng lỗi với cột bình luận nổi bật ở bài 5.08.

Bản đầy đủ trang sản phẩm:

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

      {/* grid-cols-1 (= minmax(0, 1fr)): chưa khai báo cột thì lưới tự tạo cột rộng theo nội dung,
          hàng ngày khởi hành cuộn ngang (BookingBox) sẽ kéo cả trang rộng ra trên điện thoại */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
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

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Khách mở `/san-pham/tour-da-lat-san-may-3n2d` | 12 ngày "Thứ 7, 31/10 · Về 02/11"; hai hạng có giá, "Còn 20 chỗ"; nút "Đăng nhập để đặt" |
| Đăng nhập, chọn ngày thứ 2, Cao cấp, 2 người lớn, 1 trẻ em | "Tổng cộng (3 khách) 9.470.000₫" |
| Bấm "Đặt ngay" | Sang `/dat-cho/BK-…` (bài 8.06) |
| `/san-pham/ve-tphcm-phu-quoc-mot-chieu` | Các ngày ghi "Một chiều"; nhãn "Ngày bay" |
| Màn 1440px và 390px, Console: `document.documentElement.scrollWidth` | Bằng `clientWidth` (không cuộn ngang) |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| ESLint `react/no-unescaped-entities` ở câu `Bấm "Đặt ngay"…` | Dấu `"` trong JSX; dùng “ ” (hoặc `&quot;`) |
| Đổi ngày rồi đặt lại thì vẫn ra đơn cũ | Khoá chống trùng không được xoá khi đổi lựa chọn |
| Trang bị cuộn ngang | Ba nguyên nhân ở Bước 3 |
