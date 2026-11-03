# Bài 9.06: Frontend: nút Thanh toán, chờ webhook, trang cổng giả lập; nghiệm thu Phần 09

> [← Bài trước](05-thu-api.md) · [Mục lục](../README.md) · [Phần 10 →](../10-tien-ich/01-du-lieu-lich-bay.md)

## Mục tiêu

- Đơn đặt chỗ có nút "Thanh toán {số tiền}" → chuyển sang cổng → quay về → trang tự cập nhật khi webhook tới.
- Trang cổng thanh toán giả lập (`/thanh-toan-gia-lap/[txn]`).
- Các thông báo: đang xác nhận, chưa thành công, đã thanh toán, sẽ hoàn tiền.

## Bạn sẽ học

- Chuyển sang trang **bên ngoài** (cổng thanh toán): `window.location.assign`, không phải `router.push`.
- "Khách quay về" và "webhook tới" là hai đường độc lập: trang phải **hỏi lại API** cho tới khi đơn đổi.
- Dùng `refetchInterval` của TanStack Query và dừng đúng lúc.
- Vì sao không dùng `Date.now()` lúc render.

## Viết code

### Bước 1: Kiểu dữ liệu, `frontend/src/lib/types.ts`

`Booking` có thêm `payment` (`status`, `refund_required`; `null` khi chưa từng thanh toán). Bản đầy đủ:

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
  // Khoản thanh toán đại diện cho đơn; null: chưa từng thanh toán
  payment: {
    status: "pending" | "succeeded" | "failed" | "expired";
    // Đã nhận tiền mà không giao được dịch vụ: Airlife sẽ hoàn tiền
    refund_required: boolean;
  } | null;
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

### Bước 2: Trang đặt chỗ, `frontend/src/components/booking/BookingView.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { productHref } from "@/components/product/ProductCard";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice } from "@/lib/format";
import { BOOKING_STATUS, shortDate } from "@/lib/shop";
import type { Booking } from "@/lib/types";

import { Countdown } from "./Countdown";
import { PassengerForm } from "./PassengerForm";

// Trang một đơn đặt chỗ: tóm tắt, đếm ngược giữ chỗ, form hành khách, thanh toán, huỷ.
//
// returned: khách vừa từ trang của cổng thanh toán quay về (?tt=1). Việc "khách quay về" và việc
// "cổng báo webhook về API" là hai đường riêng, đến theo thứ tự nào cũng được: khách có thể về
// trước khi webhook kịp tới. Vì vậy trang KHÔNG tin trình duyệt nói "đã trả"; nó hỏi lại API mỗi
// 2 giây (tối đa 45 giây) cho tới khi đơn đổi trạng thái.
export function BookingView({ code, returned }: { code: string; returned: boolean }) {
  const qc = useQueryClient();
  const key = ["me", "booking", code];
  // Còn đang đợi webhook không: bật khi vừa về từ cổng, tự tắt sau 45 giây. Không so Date.now()
  // lúc render (hàm không thuần: kết quả đổi theo thời gian, React Compiler không cho).
  const [waiting, setWaiting] = useState(returned);
  useEffect(() => {
    if (!returned) return;
    const id = window.setTimeout(() => setWaiting(false), 45_000);
    return () => window.clearTimeout(id);
  }, [returned]);
  const {
    data: b,
    isPending,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: key,
    queryFn: () => api<Booking>(`/me/bookings/${code}`),
    // Đang đợi webhook thì hỏi lại mỗi 2 giây cho tới khi đơn đổi trạng thái
    refetchInterval: (q) => (waiting && q.state.data?.status === "awaiting_payment" ? 2000 : false),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  // Hết giờ thì tải lại đơn (thấy "Hết hạn giữ chỗ"). Key viết thẳng trong hàm để không phụ
  // thuộc mảng `key` (mảng mới mỗi lần render làm useCallback vô tác dụng).
  const refresh = useCallback(
    () => void qc.invalidateQueries({ queryKey: ["me", "booking", code] }),
    [qc, code],
  );
  const cancel = useMutation({
    mutationFn: () => api<Booking>(`/me/bookings/${code}/cancel`, { method: "POST" }),
    onSuccess: (booking) => {
      qc.setQueryData(key, booking);
      void qc.invalidateQueries({ queryKey: ["me", "bookings"] });
    },
  });

  const pay = useMutation({
    mutationFn: () => api<{ payment_url: string }>(`/me/bookings/${code}/pay`, { method: "POST" }),
    // Sang trang của cổng thanh toán (một trang khác hẳn, không phải route của ta): tải trang mới
    onSuccess: (r) => window.location.assign(r.payment_url),
  });

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (error || !b) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Không tìm thấy đơn đặt chỗ này.{" "}
        <Link href="/dat-cho" className="font-semibold text-brand-700">
          Xem đơn của bạn
        </Link>
      </p>
    );
  }

  const active = b.status === "held" || b.status === "awaiting_payment";
  // Vừa về từ cổng, đơn vẫn chờ, chưa quá 45 giây: đang đợi webhook
  const confirming = waiting && b.status === "awaiting_payment" && b.payment?.status === "pending";
  const status = BOOKING_STATUS[b.status];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">Đặt chỗ #{b.code}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", status.tone)}>
          {status.label}
        </span>
      </header>

      {active && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning/10 p-4">
          <p className="text-sm">
            Chỗ của bạn được giữ trong thời gian bên cạnh.{" "}
            {b.status === "awaiting_payment"
              ? "Thanh toán trước khi hết giờ; quá giờ đơn tự huỷ và trả chỗ."
              : "Điền thông tin hành khách để tiếp tục."}
          </p>
          {/* key: mỗi lần tải lại đơn là một đồng hồ mới. Lỡ tải lại đúng lúc server vẫn báo
              còn hạn, đồng hồ mới đếm tiếp và gọi onExpire lần nữa thay vì đứng ở 00:00. */}
          <Countdown
            key={dataUpdatedAt}
            deadline={dataUpdatedAt + b.expires_in * 1000}
            onExpire={refresh}
          />
        </div>
      )}
      {b.status === "confirmed" && (
        <div role="status" className="flex gap-3 rounded-card bg-success/10 p-5">
          <Icon name="check" className="mt-0.5 size-6 shrink-0 text-success" />
          <p>
            <b className="block text-lg">Đã thanh toán, đặt chỗ được xác nhận!</b>
            Airlife đã gửi email xác nhận tới {b.contact?.email}.
          </p>
        </div>
      )}
      {confirming && (
        <p role="status" className="rounded-card bg-brand-50 p-4 text-brand-800">
          Đang xác nhận thanh toán với cổng… Bạn không cần làm gì thêm, trang sẽ tự cập nhật.
        </p>
      )}
      {b.status === "awaiting_payment" && !confirming && b.payment?.status === "failed" && (
        <p role="alert" className="rounded-card bg-danger/10 p-4 text-danger">
          Thanh toán chưa thành công. Bạn chưa bị trừ tiền; hãy thử lại trước khi hết giờ giữ chỗ.
        </p>
      )}
      {returned &&
        !confirming &&
        b.status === "awaiting_payment" &&
        b.payment?.status === "pending" && (
          <p role="alert" className="rounded-card bg-warning/10 p-4">
            Chưa nhận được kết quả thanh toán. Nếu bạn đã trả tiền, đơn sẽ tự xác nhận trong ít phút
            (hoặc liên hệ Airlife với mã {b.code}).
          </p>
        )}
      {b.payment?.refund_required && (
        <p role="alert" className="rounded-card bg-warning/10 p-4">
          Airlife đã nhận khoản thanh toán nhưng không thể xác nhận đặt chỗ này (hết chỗ, đã huỷ
          hoặc trả trùng). Khoản tiền sẽ được hoàn lại cho bạn; liên hệ Airlife với mã {b.code} nếu
          cần hỗ trợ.
        </p>
      )}
      {b.status === "expired" && !b.payment?.refund_required && (
        <p className="rounded-card bg-surface-2 p-4">
          Đã hết thời gian giữ chỗ.{" "}
          <Link href={productHref(b.product)} className="font-semibold text-brand-700">
            Đặt lại
          </Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-6">
          {active ? (
            <PassengerForm booking={b} />
          ) : (
            b.passengers.length > 0 && (
              <section className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
                <h2 className="mb-3 text-lg font-bold">Hành khách</h2>
                <ul className="space-y-1">
                  {b.passengers.map((p, i) => (
                    <li key={i}>
                      {p.full_name} · {formatDate(p.birth_date)} ·{" "}
                      {p.kind === "adult" ? "Người lớn" : "Trẻ em"}
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </div>

        <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <Link href={productHref(b.product)} className="flex gap-3">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
              <Image
                src={b.product.image_url}
                alt=""
                fill
                loading="eager"
                sizes="64px"
                className="object-cover"
              />
            </span>
            <span className="font-semibold hover:text-brand-700">{b.product.name}</span>
          </Link>
          <dl className="space-y-2 text-sm">
            <Row label="Hạng">{b.fare_label}</Row>
            <Row label={b.product.tag === "ve-bay" ? "Ngày bay" : "Khởi hành"}>
              {shortDate(b.depart_date)}
            </Row>
            {b.return_date && <Row label="Ngày về">{shortDate(b.return_date)}</Row>}
            <Row label={`Người lớn × ${b.adults}`}>{formatPrice(b.adult_price * b.adults)}</Row>
            {b.children > 0 && (
              <Row label={`Trẻ em × ${b.children}`}>{formatPrice(b.child_price * b.children)}</Row>
            )}
            <div className="flex justify-between border-t border-ink/[0.07] pt-2 text-base font-bold">
              <dt>Tổng cộng</dt>
              <dd className="text-accent-700">{formatPrice(b.total)}</dd>
            </div>
          </dl>
          {b.status === "awaiting_payment" && (
            <>
              <button
                type="button"
                onClick={() => pay.mutate()}
                disabled={pay.isPending || confirming}
                className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
              >
                {pay.isPending ? "Đang chuyển sang cổng…" : `Thanh toán ${formatPrice(b.total)}`}
              </button>
              {pay.error instanceof ApiError && (
                <p role="alert" className="text-sm text-danger">
                  {pay.error.message}
                </p>
              )}
            </>
          )}
          {active && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Huỷ đơn và trả lại chỗ?")) cancel.mutate();
              }}
              disabled={cancel.isPending}
              className="h-10 w-full rounded-full bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 hover:text-danger"
            >
              Huỷ giữ chỗ
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
```

Đọc theo luồng:

1. **Bấm "Thanh toán"** → `POST /me/bookings/{code}/pay` → nhận `payment_url` → `window.location.assign(url)`.
   Dùng `assign` vì cổng là một trang khác hẳn (tên miền khác khi dùng cổng thật), không phải route của
   Next.js; `router.push` chỉ đi tới route của ta.
2. **Cổng đưa khách về `/dat-cho/BK-…?tt=1`**. `tt=1` chỉ là gợi ý cho giao diện ("vừa trả xong, đang đợi
   webhook"), **không phải bằng chứng đã trả**: ai cũng gõ được vào thanh địa chỉ.
3. **`waiting`** bật khi `returned`, tự tắt sau 45 giây (`setTimeout` trong effect). Trong lúc `waiting`
   và đơn còn `awaiting_payment`, `refetchInterval` hỏi lại API mỗi 2 giây. Webhook tới → đơn thành
   `confirmed` → `refetchInterval` trả `false`, dừng hỏi, hiện "Đã thanh toán".
4. Hết 45 giây vẫn chưa đổi: hiện "Chưa nhận được kết quả… nếu đã trả tiền, đơn sẽ tự xác nhận trong ít
   phút" (đối soát, bài 9.04).
5. **Các thông báo** lấy từ `b.payment`: `failed` → "chưa thành công, chưa bị trừ tiền, thử lại"; `refund_required`
   → "sẽ được hoàn tiền".

**Vì sao không viết `Date.now() - openedAt < 45_000` trong lúc render**: ESLint (React Compiler) báo
`Cannot call impure function during render`. Hàm không thuần cho kết quả khác nhau mỗi lần gọi, nên React
không thể bỏ qua việc vẽ lại một cách an toàn. Biến "còn đợi không" thành **state** (`waiting`) và đổi nó
bằng `setTimeout`.

### Bước 3: Trang đặt chỗ nhận `?tt=1`, `frontend/src/app/dat-cho/[code]/page.tsx`

```tsx
import type { Metadata } from "next";

import { BookingView } from "@/components/booking/BookingView";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tt?: string }>;
};

// Đơn đặt chỗ là dữ liệu riêng: BookingView lấy ở trình duyệt. proxy.ts chặn khách chưa đăng nhập.
export default async function Page({ params, searchParams }: Props) {
  const [{ code }, { tt }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <BookingView code={code} returned={tt === "1"} />
    </div>
  );
}
```

### Bước 4: Trang cổng giả lập

`frontend/src/components/booking/FakeGateway.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { ApiError, api } from "@/lib/api";
import { formatPrice } from "@/lib/format";

type Session = {
  txn: string;
  description: string;
  amount: number;
  status: "pending" | "succeeded" | "failed";
  return_url: string;
};

// Trang của cổng thanh toán GIẢ LẬP: thay cho trang VNPay/MoMo khi chưa có tài khoản cổng thật.
// Nó chỉ tồn tại ở dev: API không đăng ký các route /dev/fake-gateway ở production. Cổng thật là
// trang của họ, nằm ở tên miền khác; ta chỉ chuyển khách tới đó và đón khách quay về.
export function FakeGateway({ txn }: { txn: string }) {
  const {
    data: s,
    isPending,
    error,
  } = useQuery({
    queryKey: ["fake-gateway", txn],
    queryFn: () => api<Session>(`/dev/fake-gateway/${txn}`),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: (result: "succeeded" | "failed") =>
      api<{ return_url: string }>(`/dev/fake-gateway/${txn}`, {
        method: "POST",
        body: JSON.stringify({ result }),
      }),
    onSuccess: (r) => window.location.assign(r.return_url),
  });

  if (isPending)
    return <div className="mx-auto h-64 max-w-md animate-pulse rounded-card bg-surface-2" />;
  if (error instanceof ApiError || !s) {
    return (
      <p className="mx-auto max-w-md rounded-card bg-surface p-6 text-center text-ink-muted shadow-sm">
        Không có phiên thanh toán này (cổng giả lập chỉ chạy khi phát triển).
      </p>
    );
  }
  const settled = s.status !== "pending";
  return (
    <div className="mx-auto max-w-md space-y-5 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07]">
      <p className="rounded-card-sm bg-warning/15 px-3 py-2 text-center text-sm font-semibold text-accent-800">
        CỔNG THANH TOÁN GIẢ LẬP · chỉ dùng khi phát triển
      </p>
      <div className="text-center">
        <p className="text-sm text-ink-muted">{s.description}</p>
        <p className="mt-1 text-3xl font-bold text-accent-700">{formatPrice(s.amount)}</p>
      </div>
      {settled ? (
        <p className="text-center text-ink-muted">
          Phiên này đã {s.status === "succeeded" ? "thanh toán" : "kết thúc"}.{" "}
          <a href={s.return_url} className="font-semibold text-brand-700">
            Quay lại Airlife
          </a>
        </p>
      ) : (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => complete.mutate("succeeded")}
            disabled={complete.isPending}
            className="h-12 rounded-full bg-success font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            Thanh toán thành công
          </button>
          <button
            type="button"
            onClick={() => complete.mutate("failed")}
            disabled={complete.isPending}
            className="h-12 rounded-full bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 disabled:opacity-60"
          >
            Thanh toán thất bại
          </button>
          {/* Quay lại mà không trả: bỏ ?tt=1 (đó là dấu "vừa trả xong, đang đợi webhook") */}
          <a
            href={s.return_url.split("?")[0]}
            className="text-center text-sm font-semibold text-ink-muted hover:text-ink"
          >
            Quay lại Airlife, chưa thanh toán
          </a>
        </div>
      )}
      {complete.error instanceof ApiError && (
        <p role="alert" className="text-sm text-danger">
          {complete.error.message}
        </p>
      )}
    </div>
  );
}
```

`frontend/src/app/thanh-toan-gia-lap/[txn]/page.tsx`:

```tsx
import type { Metadata } from "next";

import { FakeGateway } from "@/components/booking/FakeGateway";

export const metadata: Metadata = { title: "Cổng thanh toán giả lập", robots: { index: false } };

type Props = { params: Promise<{ txn: string }> };

// Không nằm trong proxy.ts: cổng thật không có cookie đăng nhập của ta, trang này cũng vậy.
export default async function Page({ params }: Props) {
  const { txn } = await params;
  return (
    <div className="mx-auto max-w-3xl px-3 py-10">
      <FakeGateway txn={txn} />
    </div>
  );
}
```

- **Không nằm trong `proxy.ts`**: cổng thật không có cookie đăng nhập của ta; trang này cũng không cần.
  (Matcher `"/thanh-toan"` khớp **đúng** đường dẫn đó, không khớp `/thanh-toan-gia-lap/…`.)
- **Dải cảnh báo "CỔNG THANH TOÁN GIẢ LẬP"** để không ai nhầm nó với trang thật.
- **Nút "Quay lại Airlife, chưa thanh toán"** dùng `return_url` bỏ `?tt=1`: khách chưa trả thì không nên
  thấy "Đang xác nhận thanh toán…".

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
```

| Làm gì | Thấy gì |
|---|---|
| Đặt tour, điền hành khách, mở `/dat-cho/BK-…` | Cột phải có nút "Thanh toán 1.890.000₫" trên nút "Huỷ giữ chỗ" |
| Bấm "Thanh toán" | Sang `/thanh-toan-gia-lap/FK-…`: dải "CỔNG THANH TOÁN GIẢ LẬP", số tiền, ba lựa chọn |
| "Thanh toán thành công" | Về `/dat-cho/BK-…?tt=1`; vài giây sau (hoặc ngay) "Đã thanh toán, đặt chỗ được xác nhận!", trạng thái "Đã xác nhận", form hành khách biến thành danh sách; Mailpit có thư "Đặt chỗ của bạn đã được xác nhận" |
| `/ban` | Đơn có nhãn "Đã xác nhận" |
| Đơn khác: "Thanh toán thất bại" | Về trang đơn, vẫn "Chờ thanh toán", dải đỏ "Thanh toán chưa thành công. Bạn chưa bị trừ tiền…"; bấm "Thanh toán" lần nữa, trả thành công thì xác nhận |
| "Quay lại Airlife, chưa thanh toán" | Về trang đơn, không có dòng "Đang xác nhận" |
| `/thanh-toan-gia-lap/FK-KHONGCO` | "Không có phiên thanh toán này" |
| Console | Không lỗi, không cảnh báo |

Dọn dữ liệu thử như bài 9.05, rồi:

```bash
git add . && git commit -m "Thanh toán online: cổng giả lập, webhook, đối soát"
```

Đến đây xong Phần 09. Gắn VNPay/MoMo/ZaloPay thật: viết một adapter thoả `pkg/payment.Gateway`, thêm
giá trị vào `PAYMENT_PROVIDER`, cấu hình địa chỉ webhook ở trang quản trị của cổng.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trang đơn kẹt "Đang xác nhận thanh toán…" | Webhook không tới: kiểm tra `PAYMENT_NOTIFY_URL`, `make logs s=api`; đối soát sẽ xử lý sau tối đa vài phút |
| ESLint `Cannot call impure function during render` | Không gọi `Date.now()`, `Math.random()` lúc render; dùng state + `setTimeout` |
| Trang vẫn hiện "đang chờ" sau khi `curl` cho thấy đơn `confirmed` | `refetchInterval` hết hạn (`waiting` đã tắt sau 45 giây); tải lại trang |
| Bấm "Thanh toán" không chuyển trang | `payment_url` rỗng hoặc API lỗi: xem thông báo đỏ dưới nút; `booking_not_payable` = đơn chưa điền hành khách, đã hết hạn, đã huỷ hoặc đã thanh toán |
