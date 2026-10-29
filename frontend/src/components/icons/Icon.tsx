import type { ReactElement } from "react";

import { cn } from "@/lib/cn";

import { PLAYER_ICONS, type PlayerIconName } from "./player-icons";

// Icon nét 24×24 (vẽ bằng stroke), lấy từ mockup Skyline (js/layout.js, ICON_PATHS).
// Dùng cho những chỗ bộ thiết kế Player chưa có icon: tìm kiếm, giỏ hàng, chuông…
const LINE_ICONS = {
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v4h16v-4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12h12L22 7H6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
      <path d="m9 11 5 3-5 3z" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 19 5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  news: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h10M7 16h6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v10H10l-4 4v-4H4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  store: (
    <>
      <path d="M4 9h16l-1-5H5z" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1" />
  ),
  map: (
    <>
      <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  like: (
    <path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7" />
  ),
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  fire: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  minus: <path d="M5 12h14" />,
  caret: <path d="m7 10 5 5 5-5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  login: <path d="M10 4H6v16h4M14 8l4 4-4 4M18 12H7" />,
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />,
} satisfies Record<string, ReactElement>;

type LineIconName = keyof typeof LINE_ICONS;
export type IconName = LineIconName | PlayerIconName;

type IconProps = {
  name: IconName;
  className?: string;
};

// Mặc định size-5 (20px); đổi cỡ bằng className, vd. "size-6".
// aria-hidden: icon chỉ để trang trí, nút chứa icon phải tự có aria-label.
export function Icon({ name, className }: IconProps) {
  if (name in PLAYER_ICONS) {
    const icon = PLAYER_ICONS[name as PlayerIconName];
    return (
      <svg
        viewBox={icon.viewBox}
        aria-hidden="true"
        className={cn("size-5 shrink-0 fill-current", className)}
      >
        {icon.paths.map((p, i) => (
          // Danh sách tĩnh, không đổi thứ tự: dùng index làm key là an toàn
          <path key={i} d={p.d} fillRule={p.evenOdd ? "evenodd" : "nonzero"} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      {LINE_ICONS[name as LineIconName]}
    </svg>
  );
}
