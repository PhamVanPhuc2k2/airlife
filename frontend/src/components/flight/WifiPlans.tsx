"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { wifiPlansOptions } from "@/lib/queries";

// Tab Wi-Fi trên máy bay. Gói được mua và kích hoạt ngay trên chuyến bay (mạng AIRLIFE-WIFI), nên ở đây
// chỉ chọn gói và xem hướng dẫn; chưa có thanh toán trên web cho mục này.
export function WifiPlans() {
  const { data, isPending, isError } = useQuery(wifiPlansOptions());
  const [picked, setPicked] = useState<string | null>(null);

  if (isPending) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;
  if (isError)
    return <p className="text-danger">Không tải được các gói Wi-Fi. Vui lòng thử lại.</p>;

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 md:grid-cols-3">
        {data.map((p) => (
          <li
            key={p.id}
            className={cn(
              "relative flex flex-col gap-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]",
              p.popular && "ring-2 ring-brand-500",
            )}
          >
            {p.popular && (
              <span className="absolute right-4 top-4 rounded-full bg-gradient-brand px-2.5 py-0.5 text-xs font-semibold text-white">
                Phổ biến
              </span>
            )}
            <Icon name="wifi" className="size-7 text-brand-600" />
            <h3 className="text-lg font-bold">{p.name}</h3>
            <p className="flex-1 text-sm text-ink-muted">{p.description}</p>
            <div>
              <strong className="text-2xl">{formatPrice(p.price)}</strong>
              <small className="text-ink-muted"> / chặng bay</small>
            </div>
            <button
              type="button"
              onClick={() => setPicked(p.name)}
              className={cn(
                "h-11 rounded-full font-semibold",
                p.popular
                  ? "bg-gradient-brand text-white shadow-brand"
                  : "text-brand-700 ring-1 ring-brand-500 hover:bg-brand-50",
              )}
            >
              Chọn gói
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <p role="status" className="rounded-card bg-brand-50 p-4 text-brand-800">
          Đã chọn gói <b>{picked}</b>. Trên máy bay, kết nối mạng <b>AIRLIFE-WIFI</b> rồi chọn gói
          này để kích hoạt và thanh toán.
        </p>
      )}
    </div>
  );
}
