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
