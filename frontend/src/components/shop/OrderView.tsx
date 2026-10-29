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
