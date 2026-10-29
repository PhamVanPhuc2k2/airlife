# Bài 1.07: Mini player và thanh Player đường băng

> [← Bài trước](06-menu-doc-tab-footer.md) · [Mục lục](../README.md) · [Bài sau →](08-ghep-khung-appshell.md)

## Mục tiêu

Mini player dưới đáy trang với thanh Player kiểu đường băng của designer. Chưa phát YouTube thật
(Phần 02), nhưng đã có đủ giao diện và trạng thái phát/dừng, bật/tắt tiếng, đóng.

## Bạn sẽ học

- Khi nào viết CSS trong `globals.css` thay vì class Tailwind.
- `@apply` với biến thể responsive (`max-md:`) trong CSS.
- `animation-play-state` để tạm dừng một hoạt ảnh CSS.

## Viết code

### Bước 1: Store trình phát

#### `frontend/src/stores/player-store.ts`

```ts
import { create } from "zustand";

// Bài/video đang phát, hiện ở mini player dưới đáy trang.
// Layout gốc không bị dựng lại khi chuyển trang trong Next.js, nên state này còn nguyên khi
// khách bấm sang trang khác: nghe tiếp mà không bị ngắt (đúng ý mockup).
//
// Bản khởi đầu: chưa nối với YouTube. Phần 02 (nội dung Xem/Nghe) thêm trình phát YouTube
// thật, thời gian thực và tua 10 giây.
export type NowPlaying = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string; // "1:12:00"
};

type PlayerState = {
  current: NowPlaying | null;
  playing: boolean;
  muted: boolean;
  play: (item: NowPlaying) => void;
  togglePlay: () => void;
  toggleMute: () => void;
  close: () => void;
};

export const usePlayerStore = create<PlayerState>()((set) => ({
  current: null,
  playing: false,
  muted: false,
  play: (item) => set({ current: item, playing: true }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  close: () => set({ current: null, playing: false }),
}));
```

Layout gốc của Next.js **không bị dựng lại** khi chuyển trang, nên state này còn nguyên: khách bấm
sang trang khác vẫn nghe tiếp. Mockup (HTML tĩnh) phải lưu vào `sessionStorage` rồi dựng lại player ở
mỗi trang.

### Bước 2: CSS thanh đường băng

Thanh có vạch đứt hai bên (pseudo-element `::before`, `::after` với gradient lặp), thanh tiến độ và
chiếc máy bay ở đầu. Viết bằng class Tailwind thì thành chuỗi hàng trăm ký tự; nên viết CSS trong
`@layer components`, vẫn dùng `@apply` và `theme()` để lấy màu từ theme.

Bản đầy đủ của `frontend/src/app/globals.css` sau bài này:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    /* Chặn iOS tự phóng to chữ khi xoay ngang */
    -webkit-text-size-adjust: 100%;
  }

  body {
    @apply bg-bg font-sans text-ink antialiased;
  }

  /* Viền focus rõ ràng cho người dùng bàn phím; chuột bấm thì không hiện */
  :focus-visible {
    @apply outline-none ring-2 ring-brand-500 ring-offset-2 ring-offset-bg;
  }
}

@layer components {
  /* Nút tròn chỉ có icon (☰, chuông, giỏ hàng…). Nút phải có aria-label vì không có chữ. */
  .icon-btn {
    @apply relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink;
  }

  /* Thanh Player kiểu đường băng (bộ thiết kế Player): vạch đứt hai bên, đầu thanh là máy bay.
     Viết bằng CSS thay vì class Tailwind vì có ::before/::after với gradient lặp, viết inline
     thành một chuỗi class rất dài, khó đọc. */
  .runway {
    @apply relative py-[9px];
  }
  .runway::before,
  .runway::after {
    content: "";
    @apply absolute inset-x-1.5 h-0.5 transition-[background] duration-300;
    background: repeating-linear-gradient(
      90deg,
      theme("colors.runway.dash") 0 14px,
      transparent 14px 26px
    );
  }
  .runway::before {
    @apply top-0.5;
  }
  .runway::after {
    @apply bottom-0.5;
  }
  .runway__track {
    @apply relative block h-2.5 rounded-full bg-runway-track;
  }
  .runway__fill {
    @apply relative block h-full min-w-2.5 rounded-full bg-runway-dash transition-[background] duration-300;
  }
  .runway__plane {
    @apply absolute -right-3 top-1/2 size-[26px] -translate-y-1/2 text-runway-dash;
    filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.5));
  }
  /* Đang phát: vạch, thanh và máy bay sáng trắng */
  .runway.is-running::before,
  .runway.is-running::after {
    background: repeating-linear-gradient(90deg, #fff 0 14px, transparent 14px 26px);
  }
  .runway.is-running .runway__fill {
    @apply bg-white;
  }
  .runway.is-running .runway__plane {
    @apply text-white;
  }
  /* Biến thể cho mini player trên điện thoại (< 768px): thanh thu thành vạch mảnh 3px nằm sát
     mép trên của mini player, bỏ vạch đứt hai bên. Màn rộng giữ nguyên thanh đầy đủ. */
  .runway--compact {
    @apply max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:p-0;
  }
  .runway--compact::before,
  .runway--compact::after {
    @apply max-md:hidden;
  }
  .runway--compact .runway__track,
  .runway--compact .runway__fill {
    @apply max-md:h-[3px] max-md:rounded-none;
  }
  .runway--compact .runway__plane {
    @apply max-md:size-[18px];
  }
}
```

- **`theme("colors.runway.dash")`**: lấy màu từ `tailwind.config.ts`, không chép mã màu.
- **`.runway--compact` với `max-md:`**: trên điện thoại thanh thu thành vạch 3px sát mép trên mini
  player. `max-md:` nghĩa là "dưới 768px", dùng được trong `@apply`.

Thêm hoạt ảnh vào `theme.extend` của `frontend/tailwind.config.ts`:

```ts
      // Thanh Player chạy minh hoạ khi chưa nối YouTube (Phần 02 thay bằng thời gian thật)
      keyframes: {
        runway: { to: { width: "100%" } },
      },
      animation: {
        runway: "runway 90s linear forwards",
      },
```

Tailwind sinh class `animate-runway`.

### Bước 3: `frontend/src/components/player/Runway.tsx`

```tsx
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";

type RunwayProps = {
  // Phần đã chạy, 0–100
  progress: number;
  // Đang phát: vạch và máy bay sáng trắng
  running: boolean;
  // Chạy minh hoạ bằng CSS khi chưa có thời gian thật (bỏ ở Phần 02, khi nối YouTube)
  animate?: boolean;
  className?: string;
};

// Thanh Player kiểu đường băng của bộ thiết kế Player. CSS ở globals.css (.runway…).
export function Runway({ progress, running, animate = false, className }: RunwayProps) {
  return (
    <div
      className={cn("runway", running && "is-running", className)}
      role="progressbar"
      aria-label="Tiến độ phát"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
    >
      <span className="runway__track">
        <span
          className={cn("runway__fill", animate && "animate-runway")}
          // Đang tạm dừng thì dừng luôn hoạt ảnh, không chạy tiếp
          style={{
            width: `${progress}%`,
            animationPlayState: running ? "running" : "paused",
          }}
        >
          <Icon name="plane-thumb" className="runway__plane" />
        </span>
      </span>
    </div>
  );
}
```

- **`role="progressbar"` + `aria-valuenow`**: trình đọc màn hình đọc được "đã phát 40%".
- **`animationPlayState: running ? "running" : "paused"`**: bấm dừng thì thanh đứng lại tại chỗ.
  Mockup chỉ bỏ class, làm hoạt ảnh chạy lại từ đầu khi bấm phát tiếp.

### Bước 4: `frontend/src/components/layout/MiniPlayer.tsx`

```tsx
"use client";

import Image from "next/image";

import { Icon } from "@/components/icons/Icon";
import { Runway } from "@/components/player/Runway";
import { cn } from "@/lib/cn";
import { usePlayerStore } from "@/stores/player-store";

// Mini player dưới đáy trang: giữ bài đang nghe khi chuyển trang.
// Màn ≥ 768px: đầy đủ nút, thanh đường băng ở giữa.
// Điện thoại: nằm trên thanh tab, chỉ còn nút phát/dừng và đóng; thanh tiến độ thu thành
// vạch mảnh ở mép trên.
export function MiniPlayer() {
  const { current, playing, muted, togglePlay, toggleMute, close } = usePlayerStore();
  if (!current) return null;

  return (
    <div
      className="fixed bottom-tabbar left-0 right-0 z-[95] flex h-player items-center gap-2 bg-overlay/95 pl-2.5 pr-2 text-white shadow-[0_-10px_30px_rgb(15_23_42/0.25)] backdrop-blur-md transition-[left] duration-300 ease-brand md:bottom-0 md:left-sidebar-mini md:gap-4 md:px-4 xl:left-sidebar xl:group-data-[collapsed=true]/app:left-sidebar-mini"
      role="region"
      aria-label="Trình phát"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[280px] md:flex-none">
        <Image
          src={current.thumbnail}
          alt=""
          width={46}
          height={46}
          className="size-[46px] rounded-lg object-cover"
        />
        <div className="grid min-w-0">
          <strong className="truncate">{current.title}</strong>
          <small className="truncate text-white/55">{current.channel}</small>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <PlayerButton label="Tua lại 10 giây" className="hidden md:inline-flex">
          <Icon name="rewind" className="size-7" />
        </PlayerButton>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Tạm dừng" : "Phát"}
          className="inline-flex size-10 items-center justify-center rounded-full bg-gradient-brand text-white transition hover:brightness-110"
        >
          <Icon name={playing ? "pause" : "play"} className="size-5" />
        </button>
        <PlayerButton label="Tua tới 10 giây" className="hidden md:inline-flex">
          <Icon name="forward" className="size-7" />
        </PlayerButton>
      </div>

      {/* runway--compact: điện thoại thu thành vạch mảnh ở mép trên (globals.css) */}
      <Runway
        progress={0}
        running={playing}
        animate
        className="runway--compact md:min-w-0 md:flex-1"
      />

      <span className="hidden text-xs text-white/60 md:inline">{current.duration}</span>

      {/* Bật/tắt tiếng: trắng khi bật, xám khi tắt, như bản on/off của thiết kế */}
      <PlayerButton
        label={muted ? "Bật tiếng" : "Tắt tiếng"}
        pressed={!muted}
        onClick={toggleMute}
        className={cn("hidden md:inline-flex", muted && "!text-runway-off")}
      >
        <Icon name="sound" className="size-7" />
      </PlayerButton>
      <PlayerButton label="Đóng trình phát" onClick={close}>
        <Icon name="close" className="size-[22px]" />
      </PlayerButton>
    </div>
  );
}

function PlayerButton({
  label,
  onClick,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}
```

- **`if (!current) return null`**: chưa phát gì thì không có mini player.
- **`bottom-tabbar md:bottom-0`**: trên điện thoại mini player nằm **trên** thanh tab.
- **`next/image`** cho ảnh bìa: Next tự đổi cỡ, nén ảnh. Ảnh YouTube (`i.ytimg.com`) đã được cho phép
  trong `next.config.ts` (bài 1.02).
- **Nút bật/tắt tiếng**: `aria-pressed` báo trạng thái bật/tắt cho trình đọc màn hình; tắt tiếng thì
  icon xám (`text-runway-off`), đúng bản on/off của file thiết kế.

### Bước 5: Nút phát thử (tạm)

#### `frontend/src/components/dev/DemoPlayButton.tsx`

```tsx
"use client";

import { usePlayerStore } from "@/stores/player-store";

// TẠM: nút mở mini player để xem layout. Xoá cùng trang tạm khi làm trang chủ thật (Phần 02).
export function DemoPlayButton() {
  const play = usePlayerStore((s) => s.play);
  return (
    <button
      type="button"
      onClick={() =>
        play({
          id: "demo",
          title: "Lofi Trên Mây — Playlist cất cánh",
          channel: "Airlife",
          thumbnail: "/brand/airlife-mark.svg",
          duration: "1:12:00",
        })
      }
      className="rounded-card-sm border border-brand-600 px-5 py-2.5 font-semibold text-brand-700 transition hover:bg-brand-50"
    >
      Phát thử mini player
    </button>
  );
}
```

Gắn vào trang tạm `frontend/src/app/page.tsx`, ngay sau nút "Mua ngay":

```tsx
import { DemoPlayButton } from "@/components/dev/DemoPlayButton";

// Trang tạm: kiểm tra logo, font, theme Tailwind và layout. Phần 02 thay bằng trang chủ thật.
const swatches = [
  { name: "brand-600", className: "bg-brand-600 text-white" },
  { name: "brand-300", className: "bg-brand-300 text-ink" },
  { name: "accent-700", className: "bg-accent-700 text-white" },
  { name: "accent-light", className: "bg-accent-light text-ink" },
  { name: "surface-2", className: "bg-surface-2 text-ink" },
  { name: "overlay", className: "bg-overlay text-white" },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu ảnh */}
      <img
        src="/brand/airlife-logo.svg"
        alt="Airlife – Đời sống hàng không"
        className="h-24 w-auto"
      />

      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Đời sống hàng không</h1>
        <p className="text-ink-muted">
          Font Be Vietnam Pro: ă â đ ê ô ơ ư — Ấ Ầ Ẩ Ẫ Ậ — Phở Hà Nội, Đà Lạt, Huế.
        </p>
        <p className="text-lg font-semibold text-accent-700">1.590.000₫</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {swatches.map((s) => (
          <div
            key={s.name}
            className={`rounded-card p-4 text-sm font-medium shadow-sm ${s.className}`}
          >
            {s.name}
          </div>
        ))}
        <div className="col-span-2 rounded-card bg-gradient-accent p-4 text-sm font-medium text-white sm:col-span-3">
          gradient-accent
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button className="rounded-card-sm bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-brand transition hover:bg-brand-700">
          Xem ngay
        </button>
        <button className="rounded-card-sm bg-accent-700 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-800">
          Mua ngay
        </button>
        <DemoPlayButton />
      </div>

      <div className="rounded-card bg-overlay p-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
        <img src="/brand/airlife-logo-white.svg" alt="Airlife" className="h-16 w-auto" />
      </div>
    </main>
  );
}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-format
```

Thấy kết quả trên trình duyệt ở bài 1.08.

```bash
git add . && git commit -m "Mini player, thanh Player đường băng"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `animate-runway` không có tác dụng | `keyframes` và `animation` phải nằm trong `theme.extend`, không phải `theme` |
| `@apply` báo `The max-md: class does not exist` | Tailwind dưới 3.2 không có `max-*`. Dự án dùng 3.4.17 nên không gặp |
| `Invalid src prop ... hostname "i.ytimg.com" is not configured` | Thiếu `remotePatterns` trong `next.config.ts` |
