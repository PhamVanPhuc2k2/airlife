# Bài 8.06: Trang giữ chỗ: đếm ngược, hành khách; nghiệm thu Phần 08

> [← Bài trước](05-frontend-chon-chuyen.md) · [Mục lục](../README.md)

## Mục tiêu

- `/dat-cho/[code]`: đồng hồ đếm ngược thời gian giữ chỗ, form người liên hệ và hành khách, tóm tắt đơn,
  huỷ. Hết giờ thì tự chuyển "Hết hạn giữ chỗ".
- `/dat-cho`: danh sách đơn; trang Bạn có "Vé và tour đã đặt".

## Bạn sẽ học

- Đếm ngược theo "số giây còn lại" của server, không theo giờ máy khách.
- Một lỗi làm tròn khiến đồng hồ kẹt ở 00:00, và cách dùng `key` để làm mới component.
- `useFieldArray` của react-hook-form; tên lỗi của server trùng tên ô.

## Viết code

### Bước 1: `frontend/src/components/booking/Countdown.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

// Đồng hồ đếm ngược thời gian giữ chỗ. deadline: mốc hết hạn theo ĐỒNG HỒ MÁY KHÁCH, tính bằng
// lúc nhận phản hồi + expires_in (số giây server tính), nên máy khách chạy nhanh/chậm vài phút
// cũng không làm sai. Hết giờ thì gọi onExpire (tải lại đơn để thấy trạng thái "hết hạn").
export function Countdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  // Làm tròn lên (như server): chỉ hiện 00:00 khi đã thật sự hết giờ
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span
      role="timer"
      aria-label={`Còn ${Math.floor(left / 60)} phút ${left % 60} giây giữ chỗ`}
      className={cn(
        "font-mono text-2xl font-bold tabular-nums",
        left < 120 ? "text-danger" : "text-accent-700",
      )}
    >
      {mm}:{ss}
    </span>
  );
}
```

**Lỗi đồng hồ kẹt ở 00:00** (gặp khi thử): server làm tròn **xuống** số giây còn lại, trình duyệt làm tròn
**gần nhất**. Còn 0,4 giây thì đồng hồ đã hiện 00:00 và gọi `onExpire`, trang tải lại đơn; server vẫn thấy
đơn còn hạn và trả `expires_in = 0`. Đồng hồ vẫn ở 0, effect `[left]` không chạy lại (0 → 0), kẹt ở "Chờ
thanh toán" mãi. Sửa ba chỗ:

1. Server làm tròn lên (`math.Ceil`, `booking.Get`).
2. Trình duyệt làm tròn lên (`Math.ceil`): chỉ hiện 00:00 khi thật sự hết.
3. `<Countdown key={dataUpdatedAt} …>`: mỗi lần tải lại đơn là một đồng hồ mới, có lỡ tải sớm thì đồng hồ
   mới đếm tiếp và gọi `onExpire` lần nữa.

### Bước 2: `frontend/src/components/booking/PassengerForm.tsx`

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { passportName } from "@/lib/shop";
import type { Booking } from "@/lib/types";

type Values = {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  passengers: { full_name: string; birth_date: string }[];
};

// Người liên hệ và hành khách. Luật thật (tuổi theo ngày khởi hành, họ tên không dấu, số người
// lớn/trẻ em khớp lúc giữ chỗ) do backend kiểm tra (booking.validateDetails) và trả lỗi theo
// từng ô: tên lỗi "passengers.0.full_name" trùng đúng tên ô của react-hook-form.
export function PassengerForm({ booking: b }: { booking: Booking }) {
  const qc = useQueryClient();
  const { me } = useMe();
  // Thứ tự ô: người lớn trước, trẻ em sau (như lúc giữ chỗ)
  const kinds = [
    ...Array.from({ length: b.adults }, () => "Người lớn"),
    ...Array.from({ length: b.children }, () => "Trẻ em (2–11 tuổi)"),
  ];
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: {
      contact_name: b.contact?.name ?? me?.display_name ?? "",
      contact_phone: b.contact?.phone ?? "",
      contact_email: b.contact?.email ?? me?.email ?? "",
      passengers: kinds.map((_, i) => ({
        full_name: b.passengers[i]?.full_name ?? "",
        birth_date: b.passengers[i]?.birth_date ?? "",
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: "passengers" });
  const names = useWatch({ control, name: "passengers" });

  const save = useMutation({
    mutationFn: (v: Values) =>
      api<Booking>(`/me/bookings/${b.code}/details`, { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: (booking) => qc.setQueryData(["me", "booking", b.code], booking),
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    },
  });
  const apiError = save.error instanceof ApiError ? save.error : null;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-6">
      <fieldset className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-3">
        <legend className="sr-only">Người liên hệ</legend>
        <h2 className="text-lg font-bold sm:col-span-3">Người liên hệ</h2>
        <Field
          label="Họ tên"
          autoComplete="name"
          error={errors.contact_name?.message}
          {...register("contact_name")}
        />
        <Field
          label="Số điện thoại"
          type="tel"
          autoComplete="tel"
          error={errors.contact_phone?.message}
          {...register("contact_phone")}
        />
        <Field
          label="Email nhận vé"
          type="email"
          autoComplete="email"
          error={errors.contact_email?.message}
          {...register("contact_email")}
        />
      </fieldset>

      {fields.map((f, i) => {
        const e = errors.passengers?.[i];
        const preview = passportName(names?.[i]?.full_name ?? "");
        return (
          <fieldset
            key={f.id}
            className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-[2fr_1fr]"
          >
            <legend className="sr-only">Hành khách {i + 1}</legend>
            <h2 className="text-lg font-bold sm:col-span-2">
              Hành khách {i + 1} <small className="font-normal text-ink-muted">· {kinds[i]}</small>
            </h2>
            <div>
              <Field
                label="Họ và tên (như trên CCCD, hộ chiếu)"
                autoComplete="off"
                error={e?.full_name?.message}
                {...register(`passengers.${i}.full_name`)}
              />
              {preview && <p className="mt-1 text-xs text-ink-muted">In trên vé: {preview}</p>}
            </div>
            <Field
              label="Ngày sinh"
              type="date"
              error={e?.birth_date?.message}
              {...register(`passengers.${i}.birth_date`)}
            />
          </fieldset>
        );
      })}

      {apiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
          {apiError.fields?.passengers ?? apiError.message}
        </p>
      )}
      <button
        type="submit"
        disabled={save.isPending}
        className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60 sm:w-auto sm:px-10"
      >
        {save.isPending
          ? "Đang lưu…"
          : b.status === "awaiting_payment"
            ? "Cập nhật thông tin"
            : "Tiếp tục"}
      </button>
    </form>
  );
}
```

- **Không kiểm tra tuổi ở trình duyệt**: luật nằm ở backend (`validateDetails`), lỗi trả về với tên
  `passengers.2.birth_date`, trùng đúng tên ô `register("passengers.2.birth_date")`, nên `setError` đặt
  lỗi ngay dưới ô.
- **"In trên vé: LE MINH DUC"**: xem trước tên không dấu khi đang gõ (`useWatch`).

### Bước 3: `frontend/src/components/booking/BookingView.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useCallback } from "react";

import { productHref } from "@/components/product/ProductCard";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice } from "@/lib/format";
import { BOOKING_STATUS, shortDate } from "@/lib/shop";
import type { Booking } from "@/lib/types";

import { Countdown } from "./Countdown";
import { PassengerForm } from "./PassengerForm";

// Trang một đơn đặt chỗ: tóm tắt, đếm ngược giữ chỗ, form hành khách, huỷ.
export function BookingView({ code }: { code: string }) {
  const qc = useQueryClient();
  const key = ["me", "booking", code];
  const {
    data: b,
    isPending,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: key,
    queryFn: () => api<Booking>(`/me/bookings/${code}`),
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
              ? "Thanh toán trực tuyến sắp ra mắt; hết giờ đơn sẽ tự huỷ và trả chỗ."
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
      {b.status === "expired" && (
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

`refresh` viết key thẳng trong hàm: dùng biến `key` (một mảng mới mỗi lần render) làm phụ thuộc của
`useCallback` thì hàm cũng mới mỗi lần render, ESLint báo `react-hooks/exhaustive-deps`.

### Bước 4: Danh sách và trang

`frontend/src/components/booking/BookingList.tsx`:

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";

import { LoadMore } from "@/components/ui/LoadMore";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { bookingsOptions } from "@/lib/queries";
import { BOOKING_STATUS, shortDate } from "@/lib/shop";

// Danh sách đơn đặt vé, tour (trang /dat-cho; trang Bạn hiện vài đơn với limit)
export function BookingList({ limit }: { limit?: number }) {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(bookingsOptions());
  const all = data?.pages.flatMap((p) => p.items) ?? [];
  const items = limit ? all.slice(0, limit) : all;

  if (isPending) return <div className="h-32 animate-pulse rounded-card bg-surface-2" />;
  if (items.length === 0) {
    return (
      <p className="rounded-card bg-surface p-6 text-center text-ink-muted">
        Bạn chưa đặt vé, tour nào.{" "}
        <Link href="/tour-bay" className="font-semibold text-brand-700">
          Xem tour bay
        </Link>
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-ink/[0.07] rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
        {items.map((b) => {
          const s = BOOKING_STATUS[b.status];
          return (
            <li key={b.code}>
              <Link
                href={`/dat-cho/${b.code}`}
                className="flex items-center gap-4 p-4 hover:bg-surface-2/60"
              >
                <span className="relative size-14 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                  <Image src={b.product_image} alt="" fill sizes="56px" className="object-cover" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 font-semibold">{b.product_name}</span>
                  <span className="block text-sm text-ink-muted">
                    #{b.code} · {b.fare_label} · {shortDate(b.depart_date)} ·{" "}
                    {b.adults + b.children} khách
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", s.tone)}>
                    {s.label}
                  </span>
                  <b className="text-sm">{formatPrice(b.total)}</b>
                </span>
              </Link>
            </li>
          );
        })}
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

`frontend/src/app/dat-cho/page.tsx`:

```tsx
import type { Metadata } from "next";

import { BookingList } from "@/components/booking/BookingList";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Vé và tour đã đặt</h1>
      <BookingList />
    </div>
  );
}
```

`frontend/src/app/dat-cho/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";

import { BookingView } from "@/components/booking/BookingView";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

type Props = { params: Promise<{ code: string }> };

// Đơn đặt chỗ là dữ liệu riêng: BookingView lấy ở trình duyệt. proxy.ts chặn khách chưa đăng nhập.
export default async function Page({ params }: Props) {
  const { code } = await params;
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <BookingView code={code} />
    </div>
  );
}
```

Thêm `"/dat-cho/:path*"` vào `matcher` của `frontend/src/proxy.ts`. Trang Bạn thêm "Vé và tour đã đặt"
(`BookingList limit={3}`). Bản đầy đủ `frontend/src/app/ban/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { ContinueWatching } from "@/components/account/ContinueWatching";
import { FollowingChannels } from "@/components/account/FollowingChannels";
import { LibraryStats } from "@/components/account/LibraryStats";
import { ProfileCard } from "@/components/account/ProfileCard";
import { BookingList } from "@/components/booking/BookingList";
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
      <section aria-labelledby="dat-cho">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="dat-cho" className="text-xl font-bold">
            Vé và tour đã đặt
          </h2>
          <Link href="/dat-cho" className="text-sm font-semibold text-brand-700">
            Xem tất cả
          </Link>
        </div>
        <BookingList limit={3} />
      </section>
      <ContinueWatching />
      <FollowingChannels />
    </div>
  );
}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
```

Nghiệm thu Phần 08 trên trình duyệt:

| Làm gì | Thấy gì |
|---|---|
| Đặt tour Đà Lạt 2 người lớn + 1 trẻ em | `/dat-cho/BK-…`, đồng hồ 19:5x đếm lùi, form 3 hành khách (2 "Người lớn", 1 "Trẻ em (2–11 tuổi)") |
| Gõ "Lê Minh Đức" | Dưới ô: "In trên vé: LE MINH DUC" |
| Ngày sinh bé là năm ngoái, bấm "Tiếp tục" | Dưới ô: "Chưa nhận đặt cho em bé dưới 2 tuổi" |
| Sửa thành 2018, bấm lại | Trạng thái "Chờ thanh toán", đồng hồ vẫn chạy tiếp (không cộng thêm giờ) |
| `/ban` | "Vé và tour đã đặt" có đơn vừa đặt |
| Trang sản phẩm | Số chỗ của hạng đó giảm 3 |
| `make psql`: `UPDATE bookings SET expires_at = now() + interval '6 seconds' WHERE code = 'BK-…';`, mở lại trang đơn | Đồng hồ về 00:00 rồi "Hết hạn giữ chỗ… Đặt lại"; sau tối đa 30 giây số chỗ trên trang sản phẩm trở lại |
| Đặt đơn khác, bấm "Huỷ giữ chỗ" | "Đã huỷ", số chỗ trở lại ngay |
| Console | Không có lỗi, không có cảnh báo |

Dọn dữ liệu thử như bài 8.04, rồi:

```bash
git add . && git commit -m "Đặt vé, tour: chọn chuyến, giữ chỗ, hành khách"
```

Đến đây xong Phần 08. Phần 09 thêm thanh toán online để đơn "Chờ thanh toán" thành "Đã xác nhận".

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đồng hồ về 00:00 nhưng trang vẫn "Chờ thanh toán" | Lỗi làm tròn ở Bước 1 |
| Đồng hồ trên máy này hết sớm hơn máy khác | Đếm theo `expires_at` với giờ máy khách; đếm theo `expires_in` |
| Lỗi ngày sinh của server không hiện dưới ô | Tên ô trong `register(...)` khác tên trường lỗi server trả về |
| Khi tự động thử bằng script, gõ chữ vào ô ngày không có tác dụng | Ô `type="date"` không nhận gõ chữ kiểu đó; đặt `value` qua setter gốc của `HTMLInputElement` rồi phát sự kiện `input` |
