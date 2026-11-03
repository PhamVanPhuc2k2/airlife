"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";

import { flightsOptions } from "@/lib/queries";

import { FlightRow } from "./FlightRow";

// Leaflet dùng `window` nên chỉ tải và chạy ở trình duyệt (ssr: false)
const RadarMap = dynamic(() => import("./RadarMap"), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-card bg-surface-2 md:h-[520px]" />,
});

// Tab Flightradar: bản đồ + bảng chuyến bay, tự làm mới mỗi 30 giây
export function FlightBoard({ q }: { q: string }) {
  const { data, isPending, isError } = useQuery(flightsOptions(q));
  const flights = data ?? [];
  const inAir = flights.filter((f) => f.status === "in_air").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="relative">
        <RadarMap flights={flights} />
        <span className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-surface/95 px-3 py-1 text-xs font-semibold shadow-sm">
          <i className="size-2 animate-pulse rounded-full bg-success" />
          Trực tiếp · {inAir} chuyến đang bay
        </span>
      </div>

      <section className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] lg:max-h-[520px] lg:overflow-y-auto">
        <h2 className="mb-2 text-lg font-bold">Bảng chuyến bay</h2>
        {isPending ? (
          <div className="h-40 animate-pulse rounded-card-sm bg-surface-2" />
        ) : isError ? (
          <p className="text-danger">Không tải được bảng chuyến bay. Vui lòng thử lại.</p>
        ) : flights.length === 0 ? (
          <p className="text-ink-muted">
            {q ? `Không có chuyến bay nào khớp “${q}”.` : "Hiện chưa có chuyến bay."}
          </p>
        ) : (
          <div className="divide-y divide-ink/[0.07]">
            {flights.map((f) => (
              <FlightRow key={f.code} f={f} />
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-dim">
          Giờ theo giờ địa phương của từng sân bay. Dữ liệu mô phỏng theo lịch bay mẫu.
        </p>
      </section>
    </div>
  );
}
