# Bài 7.10: Thanh toán và đơn hàng

> [← Bài trước](09-gio-hang.md) · [Mục lục](../README.md) · [Bài sau →](11-gan-vao-trang-va-nghiem-thu.md)

## Mục tiêu

- `/thanh-toan`: chọn cách nhận hàng, thông tin người nhận (ô thay đổi theo cách nhận), tóm tắt đơn, phí
  giao, đặt hàng COD.
- `/don-hang`, `/don-hang/[code]`: danh sách và chi tiết đơn, huỷ đơn khi còn "Chờ xác nhận".

## Bạn sẽ học

- Sinh idempotency key **một lần** cho mỗi lần mở trang.
- zod `superRefine`: luật phụ thuộc giá trị ô khác; `z.input` / `z.output` khi có `transform`.
- `useWatch` thay `watch()` của react-hook-form (tương thích React Compiler).
- Đưa lỗi theo từng ô của server vào form (`setError`).

## Viết code

### Bước 1: `frontend/src/components/shop/CheckoutForm.tsx`

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cartKey, useCart } from "@/lib/cart";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { DELIVERY, FREE_SHIPPING_FROM, HOME_SHIPPING_FEE } from "@/lib/shop";
import type { DeliveryMethod, Order } from "@/lib/types";

// Kiểm tra ở trình duyệt để báo lỗi nhanh; backend (internal/order: validate) kiểm tra lại hết.
// superRefine: luật phụ thuộc cách nhận hàng (cần số hiệu chuyến bay hay địa chỉ).
const schema = z
  .object({
    delivery_method: z.enum(["gate", "arrival", "home", "evoucher"], {
      message: "Chọn cách nhận hàng",
    }),
    recipient_name: z.string().trim().min(2, "Họ tên từ 2 ký tự").max(100),
    phone: z
      .string()
      .transform((s) => s.replace(/[\s.-]/g, ""))
      .pipe(z.string().regex(/^(0|\+84)[35789]\d{8}$/, "Số điện thoại Việt Nam không hợp lệ")),
    flight_code: z.string().trim().toUpperCase(),
    flight_date: z.string(),
    address: z.string().trim(),
    note: z.string().trim().max(500, "Tối đa 500 ký tự"),
  })
  .superRefine((v, ctx) => {
    if (v.delivery_method === "gate" || v.delivery_method === "arrival") {
      if (!/^[A-Z0-9]{2} ?\d{1,4}$/.test(v.flight_code)) {
        ctx.addIssue({
          code: "custom",
          path: ["flight_code"],
          message: "Số hiệu chuyến bay, VD: VN 220",
        });
      }
      if (!v.flight_date) {
        ctx.addIssue({ code: "custom", path: ["flight_date"], message: "Chọn ngày bay" });
      }
    }
    if (v.delivery_method === "home" && v.address.length < 10) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Nhập địa chỉ đầy đủ" });
    }
  });
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

function today(): string {
  // Ngày theo giờ máy của khách, dạng 2026-11-14 cho <input type="date">
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function CheckoutForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useMe();
  const { cart, isLoading } = useCart();
  // Khoá chống đặt trùng: sinh MỘT lần khi mở trang. Bấm "Đặt hàng" hai lần, hay mạng gửi lại,
  // đều mang cùng khoá nên server chỉ tạo một đơn (orders.idempotency_key).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      recipient_name: "",
      phone: "",
      flight_code: "",
      flight_date: "",
      address: "",
      note: "",
    },
  });
  // useWatch (không dùng watch()): chỉ component này vẽ lại khi đổi cách nhận hàng, và tương
  // thích React Compiler (watch() trả hàm không memo được, lint báo react-hooks/incompatible-library)
  const method = useWatch({ control, name: "delivery_method" }) as DeliveryMethod | undefined;

  // Điền sẵn tên và cách nhận hàng đầu tiên khi có dữ liệu
  useEffect(() => {
    if (me) setValue("recipient_name", me.display_name);
  }, [me, setValue]);
  const firstMethod = cart?.delivery_methods[0];
  useEffect(() => {
    if (firstMethod) setValue("delivery_method", firstMethod);
  }, [firstMethod, setValue]);

  const place = useMutation({
    mutationFn: (v: Output) =>
      api<Order>("/me/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(v),
      }),
    onSuccess: (order) => {
      // Giỏ đã được server xoá; đơn mới có trong danh sách
      void qc.invalidateQueries({ queryKey: cartKey });
      void qc.invalidateQueries({ queryKey: ["me", "orders"] });
      void qc.invalidateQueries({ queryKey: ["me", "stats"] });
      router.replace(`/don-hang/${order.code}?moi=1`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
      // Hết hàng / giỏ đổi: tải lại giỏ để hiện đúng tình trạng
      if (err instanceof ApiError && ["out_of_stock", "cart_changed"].includes(err.code)) {
        void qc.invalidateQueries({ queryKey: cartKey });
      }
    },
  });

  if (isLoading || !cart) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (cart.lines.length === 0 && !place.isSuccess) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Giỏ hàng đang trống.{" "}
        <Link href="/kinh-doanh" className="font-semibold text-brand-700">
          Xem sản phẩm
        </Link>
      </p>
    );
  }

  const shipping = method === "home" && cart.subtotal < FREE_SHIPPING_FROM ? HOME_SHIPPING_FEE : 0;
  const apiError = place.error instanceof ApiError ? place.error : null;

  return (
    <form
      onSubmit={handleSubmit((v) => place.mutate(v))}
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"
    >
      <div className="space-y-6">
        <fieldset className="space-y-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <legend className="sr-only">Cách nhận hàng</legend>
          <h2 className="text-lg font-bold">Nhận hàng</h2>
          {cart.delivery_methods.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer gap-3 rounded-card-sm p-3 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                method === m
                  ? "bg-brand-50 ring-brand-600"
                  : "ring-ink/[0.14] hover:ring-brand-300",
              )}
            >
              <input
                type="radio"
                value={m}
                {...register("delivery_method")}
                className="mt-1 accent-brand-600"
              />
              <span>
                <b className="block font-semibold">{DELIVERY[m].label}</b>
                <span className="text-sm text-ink-muted">{DELIVERY[m].desc}</span>
              </span>
            </label>
          ))}
          {errors.delivery_method && (
            <p className="text-sm text-danger">{errors.delivery_method.message}</p>
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-2">
          <legend className="sr-only">Thông tin người nhận</legend>
          <h2 className="text-lg font-bold sm:col-span-2">Người nhận</h2>
          <Field
            label="Họ tên"
            autoComplete="name"
            error={errors.recipient_name?.message}
            {...register("recipient_name")}
          />
          <Field
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            error={errors.phone?.message}
            {...register("phone")}
          />
          {(method === "gate" || method === "arrival") && (
            <>
              <Field
                label="Số hiệu chuyến bay"
                placeholder="VN 220"
                autoCapitalize="characters"
                error={errors.flight_code?.message}
                {...register("flight_code")}
              />
              <Field
                label="Ngày bay"
                type="date"
                min={today()}
                error={errors.flight_date?.message}
                {...register("flight_date")}
              />
            </>
          )}
          {method === "home" && (
            <div className="sm:col-span-2">
              <Field
                label="Địa chỉ nhận hàng"
                autoComplete="street-address"
                placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"
                error={errors.address?.message}
                {...register("address")}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Field
              label="Ghi chú (không bắt buộc)"
              error={errors.note?.message}
              {...register("note")}
            />
          </div>
        </fieldset>
      </div>

      <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] lg:sticky lg:top-36">
        <h2 className="text-lg font-bold">Đơn hàng</h2>
        <ul className="space-y-3">
          {cart.lines.map((l) => (
            <li key={l.variant_id} className="flex gap-3 text-sm">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                <Image
                  src={l.product.image_url}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-semibold">{l.product.name}</span>
                <span className="text-ink-muted">
                  {l.label} × {l.quantity}
                </span>
              </span>
              <b>{formatPrice(l.price * l.quantity)}</b>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-ink/[0.07] pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Tạm tính</dt>
            <dd>{formatPrice(cart.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Phí giao hàng</dt>
            <dd>{shipping ? formatPrice(shipping) : "Miễn phí"}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>Tổng cộng</dt>
            <dd className="text-accent-700">{formatPrice(cart.subtotal + shipping)}</dd>
          </div>
        </dl>
        <p className="rounded-card-sm bg-surface-2 p-3 text-sm">
          <b>Thanh toán khi nhận hàng.</b> Thanh toán online (thẻ, ví điện tử) sắp ra mắt.
        </p>
        {apiError && (
          <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
            {apiError.message}
            {apiError.code === "email_not_verified" && (
              <>
                {" "}
                <Link href="/ban" className="font-semibold underline">
                  Xác minh email
                </Link>
              </>
            )}
            {["out_of_stock", "cart_changed", "no_common_delivery"].includes(apiError.code) && (
              <>
                {" "}
                <Link href="/gio-hang" className="font-semibold underline">
                  Về giỏ hàng
                </Link>
              </>
            )}
          </p>
        )}
        <button
          type="submit"
          disabled={place.isPending || place.isSuccess || !cart.ready}
          className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
        >
          {place.isPending
            ? "Đang đặt hàng…"
            : `Đặt hàng · ${formatPrice(cart.subtotal + shipping)}`}
        </button>
      </aside>
    </form>
  );
}
```

- **`useState(() => crypto.randomUUID())`**: key sinh một lần khi mở trang, giữ nguyên qua mọi lần render
  và mọi lần bấm. Sinh trong `onSubmit` thì mỗi lần bấm một key mới, chống trùng mất tác dụng.
- **`z.input` và `z.output`**: ô điện thoại có `transform` (bỏ dấu cách), nên kiểu lúc nhập khác kiểu sau khi
  kiểm tra; `useForm<Values, unknown, Output>` cho `handleSubmit` nhận đúng kiểu đã chuẩn hoá.
- **Phí giao tính ở trình duyệt chỉ để hiện trước**; số trên đơn do server tính (bài 7.05).
- **Lỗi `out_of_stock`, `cart_changed`**: tải lại giỏ để khách thấy món nào hết, kèm link về giỏ.

`frontend/src/app/thanh-toan/page.tsx`:

```tsx
import type { Metadata } from "next";

import { CheckoutForm } from "@/components/shop/CheckoutForm";

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false } };

// Cần đăng nhập (proxy.ts). Giỏ, thông tin người nhận là dữ liệu riêng: form lấy ở trình duyệt.
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Thanh toán</h1>
      <CheckoutForm />
    </div>
  );
}
```

### Bước 2: Đơn hàng

`frontend/src/components/shop/OrderStatus.tsx`:

```tsx
import { cn } from "@/lib/cn";
import { ORDER_STATUS } from "@/lib/shop";
import type { OrderStatus as Status } from "@/lib/types";

export function OrderStatusBadge({ status }: { status: Status }) {
  const s = ORDER_STATUS[status];
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", s.tone)}>
      {s.label}
    </span>
  );
}
```

`frontend/src/components/shop/OrderList.tsx` (`limit`: trang Bạn chỉ hiện 3 đơn mới nhất):

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";

import { LoadMore } from "@/components/ui/LoadMore";
import { formatDate, formatPrice } from "@/lib/format";
import { ordersOptions } from "@/lib/queries";
import { DELIVERY } from "@/lib/shop";

import { OrderStatusBadge } from "./OrderStatus";

// Danh sách đơn hàng (trang /don-hang; trang Bạn hiện vài đơn mới nhất với limit)
export function OrderList({ limit }: { limit?: number }) {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(ordersOptions());
  const all = data?.pages.flatMap((p) => p.items) ?? [];
  const items = limit ? all.slice(0, limit) : all;

  if (isPending) return <div className="h-40 animate-pulse rounded-card bg-surface-2" />;
  if (items.length === 0) {
    return (
      <p className="rounded-card bg-surface p-6 text-center text-ink-muted">
        Bạn chưa có đơn hàng nào.{" "}
        <Link href="/kinh-doanh" className="font-semibold text-brand-700">
          Mua sắm ngay
        </Link>
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-ink/[0.07] rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
        {items.map((o) => (
          <li key={o.code}>
            <Link
              href={`/don-hang/${o.code}`}
              className="flex items-center gap-4 p-4 hover:bg-surface-2/60"
            >
              <span className="relative size-14 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                <Image src={o.first_image} alt="" fill sizes="56px" className="object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-semibold">
                  {o.first_name}
                  {o.item_count > 1 && ` và ${o.item_count - 1} sản phẩm khác`}
                </span>
                <span className="block text-sm text-ink-muted">
                  #{o.code} · {formatDate(o.created_at)} · {DELIVERY[o.delivery_method].label}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <OrderStatusBadge status={o.status} />
                <b className="text-sm">{formatPrice(o.total)}</b>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!limit && (
        <LoadMore
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
    </>
  );
}
```

`frontend/src/components/shop/OrderView.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { productHref } from "@/components/product/ProductCard";
import { ApiError, api } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { DELIVERY } from "@/lib/shop";
import type { Order } from "@/lib/types";

import { OrderStatusBadge } from "./OrderStatus";

// Chi tiết một đơn. justPlaced: vừa đặt xong (?moi=1) thì hiện lời cảm ơn.
export function OrderView({ code, justPlaced }: { code: string; justPlaced: boolean }) {
  const qc = useQueryClient();
  const key = ["me", "order", code];
  const {
    data: o,
    isPending,
    error,
  } = useQuery({
    queryKey: key,
    queryFn: () => api<Order>(`/me/orders/${code}`),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/me/orders/${code}/cancel`, { method: "POST" }),
    onSuccess: (order) => {
      qc.setQueryData(key, order);
      void qc.invalidateQueries({ queryKey: ["me", "orders"] });
    },
  });

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (error || !o) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Không tìm thấy đơn hàng này.{" "}
        <Link href="/don-hang" className="font-semibold text-brand-700">
          Xem đơn hàng của bạn
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {justPlaced && o.status === "pending" && (
        <div role="status" className="flex gap-3 rounded-card bg-success/10 p-5">
          <Icon name="check" className="mt-0.5 size-6 shrink-0 text-success" />
          <p>
            <b className="block text-lg">Đặt hàng thành công!</b>
            Airlife đã gửi email xác nhận. Bạn thanh toán khi nhận hàng.
          </p>
        </div>
      )}

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">Đơn #{o.code}</h1>
        <OrderStatusBadge status={o.status} />
        <span className="text-ink-muted">Đặt ngày {formatDate(o.created_at)}</span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <ul className="divide-y divide-ink/[0.07] rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
          {o.items.map((it) => (
            <li key={`${it.product_slug}-${it.variant_label}`} className="flex gap-4 p-4">
              <span className="relative size-16 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                <Image src={it.image_url} alt="" fill sizes="64px" className="object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={productHref({ slug: it.product_slug })}
                  className="font-semibold hover:text-brand-700"
                >
                  {it.product_name}
                </Link>
                <span className="block text-sm text-ink-muted">
                  {it.variant_label} · {formatPrice(it.unit_price)} × {it.quantity}
                </span>
              </span>
              <b>{formatPrice(it.line_total)}</b>
            </li>
          ))}
        </ul>

        <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <section>
            <h2 className="font-bold">{DELIVERY[o.delivery_method].label}</h2>
            <p className="text-sm text-ink-2">
              {o.recipient_name} · {o.phone}
            </p>
            {o.flight_code && (
              <p className="text-sm text-ink-2">
                Chuyến {o.flight_code}, ngày {o.flight_date && formatDate(o.flight_date)}
              </p>
            )}
            {o.address && <p className="text-sm text-ink-2">{o.address}</p>}
            {o.note && <p className="text-sm text-ink-muted">Ghi chú: {o.note}</p>}
          </section>
          <dl className="space-y-2 border-t border-ink/[0.07] pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Tạm tính</dt>
              <dd>{formatPrice(o.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Phí giao hàng</dt>
              <dd>{o.shipping_fee ? formatPrice(o.shipping_fee) : "Miễn phí"}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>Tổng cộng (khi nhận hàng)</dt>
              <dd className="text-accent-700">{formatPrice(o.total)}</dd>
            </div>
          </dl>
          {o.status === "pending" && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Huỷ đơn #${o.code}?`)) cancel.mutate();
              }}
              disabled={cancel.isPending}
              className="h-10 w-full rounded-full bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 hover:text-danger"
            >
              Huỷ đơn
            </button>
          )}
          {cancel.error instanceof ApiError && (
            <p className="text-sm text-danger">{cancel.error.message}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
```

`frontend/src/app/don-hang/page.tsx`:

```tsx
import type { Metadata } from "next";

import { OrderList } from "@/components/shop/OrderList";

export const metadata: Metadata = { title: "Đơn hàng", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Đơn hàng của bạn</h1>
      <OrderList />
    </div>
  );
}
```

`frontend/src/app/don-hang/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";

import { OrderView } from "@/components/shop/OrderView";

export const metadata: Metadata = { title: "Đơn hàng", robots: { index: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ moi?: string }>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ code }, { moi }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <OrderView code={code} justPlaced={moi === "1"} />
    </div>
  );
}
```

`?moi=1`: trang thanh toán chuyển tới đây sau khi đặt, để hiện "Đặt hàng thành công!". Mở lại đơn từ danh
sách thì không có dòng đó.

### Bước 3: Chặn khách chưa đăng nhập, `frontend/src/proxy.ts`

```ts
export const config = {
  matcher: ["/ban/:path*", "/suu-tap/:path*", "/thanh-toan", "/don-hang/:path*"],
};
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Đã đăng nhập và xác minh, giỏ có cà phê, bấm "Đặt hàng" | `/thanh-toan`: "Giao tại sân bay đến" chọn sẵn, họ tên điền sẵn |
| Chọn "Giao tận nhà" | Ô số hiệu chuyến bay biến mất, hiện ô địa chỉ; phí giao 30.000₫ (đơn dưới 300.000₫) |
| Bấm đặt khi để trống số điện thoại | "Số điện thoại Việt Nam không hợp lệ" ngay dưới ô |
| Điền đủ, bấm đặt | Sang `/don-hang/AL-…?moi=1`, "Đặt hàng thành công!", huy hiệu giỏ biến mất; Mailpit có thư |
| Tài khoản chưa xác minh đặt hàng | "Bạn cần xác minh email…" kèm link "Xác minh email" |
| "Huỷ đơn" | Hỏi lại, rồi trạng thái "Đã huỷ", nút huỷ biến mất |
| Khách mở `/don-hang` | Sang trang đăng nhập |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| ESLint `react-hooks/incompatible-library`: `React Hook Form's useForm() API returns a watch() function which cannot be memoized safely` | Thay `watch("delivery_method")` bằng `useWatch({ control, name: "delivery_method" })` |
| Bấm "Đặt hàng" hai lần nhanh ra hai đơn | Key sinh trong lúc bấm; phải sinh một lần bằng `useState(() => …)` |
| Lỗi theo ô của server không hiện dưới ô | Tên trường của server (`recipient_name`…) phải trùng tên trong `register(...)` |
