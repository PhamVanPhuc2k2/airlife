import { Icon } from "@/components/icons/Icon";
import { CABIN_LABEL, dayMonthYear, flightStatus } from "@/lib/flights";
import { cn } from "@/lib/cn";
import type { MyFlight } from "@/lib/types";

// Thẻ lên máy bay (mockup: boardingPass()). Giờ là giờ địa phương của từng sân bay.
export function BoardingPass({ f, onRemove }: { f: MyFlight; onRemove?: () => void }) {
  const s = flightStatus(f);
  return (
    <article
      aria-label={`Chuyến bay ${f.code}`}
      className="grid overflow-hidden rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-[1fr_9rem]"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
          <img src="/brand/airlife-logo.svg" alt="Airlife" className="h-7 w-auto" />
          <span className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone)}>
              {s.label}
            </span>
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
              {CABIN_LABEL[f.cabin]}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <strong className="block text-3xl font-bold leading-none">{f.from.code}</strong>
            <small className="text-ink-muted">{f.from.city}</small>
            <b className="mt-1 block text-lg">{f.dep}</b>
          </div>
          <Icon name="plane" className="size-7 rotate-90 text-brand-600" />
          <div className="text-right">
            <strong className="block text-3xl font-bold leading-none">{f.to.code}</strong>
            <small className="text-ink-muted">{f.to.city}</small>
            <b className="mt-1 block text-lg">
              {f.arr}
              {f.arr_next_day && <sup className="ml-0.5 text-xs">+1</sup>}
            </b>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-dashed border-ink/15 pt-4 text-sm sm:grid-cols-5">
          <Info label="Chuyến bay" value={f.code} />
          <Info label="Ngày" value={dayMonthYear(f.date)} />
          <Info label="Cửa ra" value={f.gate || "–"} />
          <Info label="Ghế" value={f.seat || "Chưa có"} />
          <Info label="Lên tàu" value={f.boarding} />
        </dl>
      </div>

      <div className="flex flex-col items-center justify-center gap-2 border-t border-dashed border-ink/15 bg-surface-2/60 p-4 text-center sm:border-l sm:border-t-0">
        <span
          aria-hidden
          className="size-20 rounded-card-sm bg-[repeating-conic-gradient(#0f172a_0_25%,transparent_0_50%)] bg-[length:12px_12px] opacity-80"
        />
        <small className="text-ink-muted">Quét tại cửa ra</small>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-semibold text-danger hover:underline"
          >
            Bỏ chuyến này
          </button>
        )}
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
