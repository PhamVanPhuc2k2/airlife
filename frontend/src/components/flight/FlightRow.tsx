import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { flightStatus } from "@/lib/flights";
import type { Flight } from "@/lib/types";

// Một dòng chuyến bay: số hiệu, chặng, giờ (địa phương từng sân bay), trạng thái.
// Dùng ở bảng chuyến bay (Flightradar) và khối Tiện ích trên trang chủ.
export function FlightRow({ f }: { f: Flight }) {
  const s = flightStatus(f);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5">
      <strong className="text-sm">{f.code}</strong>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        {f.from.code}
        <Icon name="plane" className="size-4 shrink-0 rotate-90 text-brand-600" />
        {f.to.code}
      </span>
      <span
        className={cn("justify-self-end rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone)}
      >
        {s.label}
      </span>
      <span className="col-span-3 truncate text-xs text-ink-muted">
        {f.dep} – {f.arr}
        {f.arr_next_day && <sup className="ml-0.5 font-semibold">+1</sup>} · {f.from.city} →{" "}
        {f.to.city}
      </span>
    </div>
  );
}
