"use client";

import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { WEATHER_TONE } from "@/lib/flights";
import { timeAgo } from "@/lib/format";
import { weatherOptions } from "@/lib/queries";

// Tab Thời tiết điểm đến: thời tiết hiện tại tại các sân bay (Open-Meteo, server cache 30 phút)
export function WeatherGrid() {
  const { data, isPending, isError, refetch } = useQuery(weatherOptions());

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-card bg-surface p-6 text-center shadow-sm ring-1 ring-ink/[0.07]">
        <p className="text-ink-muted">Chưa lấy được thời tiết. Bạn thử lại sau ít phút nhé.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 font-semibold text-brand-700 hover:underline"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.airports.map((a) => (
          <li
            key={a.code}
            className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]"
          >
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full",
                WEATHER_TONE[a.condition],
              )}
            >
              <Icon name={a.condition} className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate">{a.city}</strong>
              <small className="block text-ink-muted">
                {a.code} · {a.text}
              </small>
              <small className="block text-ink-dim">
                Ẩm {a.humidity}% · gió {Math.round(a.wind_kmh)} km/h
              </small>
            </div>
            <span className="text-2xl font-bold">{Math.round(a.temp_c)}°</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-dim">
        {data.stale && "Không kết nối được nguồn thời tiết, đang hiện dữ liệu đã lưu. "}
        Cập nhật {timeAgo(data.updated_at)} · nguồn{" "}
        <a href="https://open-meteo.com" className="underline" rel="noreferrer">
          Open-Meteo
        </a>
      </p>
    </div>
  );
}
