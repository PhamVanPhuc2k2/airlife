import type { Cabin, Flight, WeatherCondition } from "./types";

export const CABIN_LABEL: Record<Cabin, string> = {
  economy: "Phổ thông",
  premium: "Phổ thông đặc biệt",
  business: "Thương gia",
  first: "Hạng nhất",
};

export const CABINS = Object.keys(CABIN_LABEL) as Cabin[];

// Nhãn + màu trạng thái chuyến bay (mockup: .status--live / warn / done / ok)
export function flightStatus(f: Pick<Flight, "status" | "delay_minutes">): {
  label: string;
  tone: string;
} {
  switch (f.status) {
    case "in_air":
      return { label: "Đang bay", tone: "bg-brand-50 text-brand-700" };
    case "landed":
      return { label: "Đã hạ cánh", tone: "bg-surface-2 text-ink-muted" };
    case "cancelled":
      return { label: "Đã huỷ", tone: "bg-danger/10 text-danger" };
    case "boarding":
      return { label: "Đang lên tàu", tone: "bg-success/15 text-success" };
    default:
      return f.delay_minutes > 0
        ? { label: `Trễ ${f.delay_minutes} phút`, tone: "bg-warning/15 text-accent-800" }
        : { label: "Đúng giờ", tone: "bg-success/15 text-success" };
  }
}

export const WEATHER_TONE: Record<WeatherCondition, string> = {
  sun: "bg-warning/15 text-accent-800",
  cloud: "bg-surface-2 text-ink-muted",
  rain: "bg-brand-50 text-brand-700",
  storm: "bg-brand-50 text-brand-700",
  fog: "bg-surface-2 text-ink-muted",
  snow: "bg-brand-50 text-brand-700",
};

// "2026-11-05" → "05/11/2026"
export function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
