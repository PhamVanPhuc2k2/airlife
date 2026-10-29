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
