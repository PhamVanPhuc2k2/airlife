import { cn } from "@/lib/cn";

// Avatar chữ cái đầu, màu cố định theo tên (chưa có ảnh đại diện thật). Theo mockup.
const COLORS = [
  "#6c3c8b",
  "#c86e3a",
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#10b981",
];

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-10 text-sm",
  lg: "size-[72px] text-2xl",
};

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof SIZES }) {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        SIZES[size],
      )}
      style={{ background: COLORS[sum % COLORS.length] }}
    >
      {initials(name)}
    </span>
  );
}
