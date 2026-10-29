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
