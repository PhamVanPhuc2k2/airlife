// Định dạng số, thời lượng, thời gian kiểu Việt Nam (giống mockup: "1,8 Tr", "54,2 N").

// 1840000 → "1,8 Tr"; 54200 → "54,2 N"; 980 → "980"
export function compactNumber(n: number): string {
  const fmt = (x: number) => x.toFixed(1).replace(".", ",").replace(",0", "");
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)} Tr`;
  if (n >= 1_000) return `${fmt(n / 1_000)} N`;
  return String(n);
}

// 7694 → "2:08:14"; 492 → "8:12"
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Nhãn thời lượng trên thẻ: phim lẻ "2:08:14", series "10 tập"
export function durationLabel(m: {
  duration_seconds: number | null;
  episode_count: number | null;
}): string {
  if (m.episode_count) return `${m.episode_count} tập`;
  if (m.duration_seconds) return formatDuration(m.duration_seconds);
  return "";
}

// "2 ngày trước", "3 tuần trước"…
export function timeAgo(iso: string, now: number = Date.now()): string {
  const sec = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const steps: [number, string][] = [
    [60, "giây"],
    [60, "phút"],
    [24, "giờ"],
    [7, "ngày"],
    [4.35, "tuần"],
    [12, "tháng"],
  ];
  let value = sec;
  for (const [size, unit] of steps) {
    if (value < size) {
      return unit === "giây" ? "vừa xong" : `${Math.floor(value)} ${unit} trước`;
    }
    value /= size;
  }
  return `${Math.floor(value)} năm trước`;
}
