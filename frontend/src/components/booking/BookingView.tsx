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
