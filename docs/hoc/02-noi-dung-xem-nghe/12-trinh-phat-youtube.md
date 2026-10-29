# Bài 2.12: Trang xem và trình phát YouTube xuyên trang

> [← Bài trước](11-trang-chuyen-muc.md) · [Mục lục](../README.md)

## Mục tiêu

`/xem/<slug>`, `/nghe/<slug>`: trình phát YouTube, thông tin, kênh, mô tả, gợi ý. Rời trang xem thì
video **phát tiếp** trong ô nổi góc dưới, mini player có tiến độ thật, tua 10 giây, tắt tiếng.

## Bạn sẽ học

- Vì sao chỉ có **một** trình phát cho cả site, và kỹ thuật "ô dành chỗ" (slot).
- YouTube IFrame Player API: tải script, tạo `YT.Player`, nghe `onStateChange`.
- Quy định của YouTube: khung nhúng tối thiểu 200×200px.
- `notFound()`, `permanentRedirect()`, `generateMetadata`, `cache()` của React.

## Viết code

### Bước 1: Vấn đề và cách giải

Mỗi trang xem có một `<iframe>` YouTube của riêng nó: chuyển trang là iframe bị gỡ, video dừng.
Đặt iframe vào `AppShell` (không bị dựng lại khi chuyển trang) thì giữ được. Nhưng iframe phải hiện
**đúng chỗ** trong trang xem, mà nếu dùng JavaScript **di chuyển** iframe sang chỗ khác trong DOM thì
trình duyệt tải lại nó từ đầu.

Cách giải:
- Trang xem chỉ đặt một **ô trống** (`PlayerSlot`), báo vị trí ô vào store.
- Trình phát (`YouTubeHost`, trong `AppShell`) là `position: fixed`, đo vị trí ô và **đè khít lên**,
  chạy theo khi cuộn.
- Rời trang: ô bị gỡ → trình phát thu về góc dưới thành ô nổi.

Ô nổi là **356×200**, không nhỏ hơn: [YouTube API Services – Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
quy định khung nhúng tối thiểu 200×200px. Mockup thu video thành ảnh 46px trong mini player; với
YouTube thì không được phép.

### Bước 2: Kiểu cho YouTube IFrame API

```bash
make npm c="install --save-exact --save-dev @types/youtube@0.3.0"
```

Gói này khai báo namespace `YT` nhưng thiếu hàm toàn cục mà script YouTube gọi khi tải xong.

#### `frontend/src/types/youtube.d.ts`

```ts
// Script https://www.youtube.com/iframe_api gọi hàm toàn cục này khi tải xong.
// @types/youtube khai báo namespace YT nhưng không khai báo hàm này trên window.
export {};

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}
```

`export {}` biến file thành module, để `declare global` hợp lệ.

### Bước 3: Store trình phát (viết lại)

#### `frontend/src/stores/player-store.ts`

```ts
import { create } from "zustand";

// Trạng thái trình phát dùng chung cho cả trang.
//
// Chỉ có MỘT trình phát YouTube (YouTubeHost, gắn trong AppShell). Trang xem đăng ký một "ô"
// (slot) để trình phát nằm đè đúng chỗ đó; rời trang xem thì ô bị gỡ và trình phát thu thành
// ô nổi nhỏ ở góc dưới. Vì iframe không bao giờ bị gỡ khỏi DOM, video không tải lại khi
// chuyển trang. (Di chuyển iframe sang chỗ khác trong DOM là trình duyệt tải lại nó từ đầu.)
export type NowPlaying = {
  slug: string;
  category: string;
  title: string;
  channel: string;
  thumbnail: string;
  youtubeId: string;
};

// Các lệnh điều khiển trình phát thật. YouTubeHost đăng ký khi trình phát sẵn sàng; nút ở
// mini player gọi qua đây, không cần biết gì về YouTube.
export type PlayerController = {
  play: () => void;
  pause: () => void;
  seekBy: (seconds: number) => void;
  setMuted: (muted: boolean) => void;
};

type PlayerState = {
  current: NowPlaying | null;
  playing: boolean;
  muted: boolean;
  time: number; // giây đã phát
  duration: number; // tổng số giây
  slot: HTMLElement | null;
  controller: PlayerController | null;

  play: (item: NowPlaying) => void;
  togglePlay: () => void;
  toggleMute: () => void;
  seekBy: (seconds: number) => void;
  close: () => void;

  // Chỉ YouTubeHost / PlayerSlot gọi
  setSlot: (el: HTMLElement | null) => void;
  setController: (c: PlayerController | null) => void;
  setPlaying: (playing: boolean) => void;
  setProgress: (time: number, duration: number) => void;
};

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  current: null,
  playing: false,
  muted: false,
  time: 0,
  duration: 0,
  slot: null,
  controller: null,

  play: (item) => {
    if (get().current?.slug === item.slug) return; // đang phát đúng bài này rồi
    set({ current: item, playing: true, time: 0, duration: 0 });
  },
  togglePlay: () => {
    const { playing, controller } = get();
    if (playing) controller?.pause();
    else controller?.play();
  },
  toggleMute: () => {
    const muted = !get().muted;
    get().controller?.setMuted(muted);
    set({ muted });
  },
  seekBy: (seconds) => get().controller?.seekBy(seconds),
  close: () => {
    get().controller?.pause();
    set({ current: null, playing: false, time: 0, duration: 0 });
  },

  setSlot: (el) => set({ slot: el }),
  setController: (c) => set({ controller: c }),
  setPlaying: (playing) => set({ playing }),
  setProgress: (time, duration) => set({ time, duration }),
}));
```

**`controller`**: nút trên mini player không gọi thẳng `YT.Player` (nó nằm trong component khác).
`YouTubeHost` đăng ký bộ hàm điều khiển khi trình phát sẵn sàng; nút gọi `controller.pause()`. Mini
player không cần biết gì về YouTube; sau này đổi sang trình phát khác chỉ sửa `YouTubeHost`.

### Bước 4: `frontend/src/components/player/YouTubeHost.tsx`

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePlayerStore } from "@/stores/player-store";

// Trình phát YouTube duy nhất của cả site (xem giải thích ở stores/player-store.ts).
//
// Hai chế độ hiển thị:
//   - Có slot (đang ở trang xem): position fixed, đè khít lên ô của trang xem, chạy theo khi cuộn.
//   - Không có slot: ô nổi 356×200 ở góc dưới phải. YouTube bắt buộc khung nhúng tối thiểu
//     200×200px (YouTube API Services – Required Minimum Functionality), nên không thu nhỏ hơn.

// Tải script IFrame API của YouTube một lần duy nhất, dùng chung Promise cho mọi lần gọi.
let apiReady: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiReady;
}

export function YouTubeHost() {
  const current = usePlayerStore((s) => s.current);
  const slot = usePlayerStore((s) => s.slot);
  const hostRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const countedRef = useRef<string | null>(null); // slug đã gửi lượt xem

  // Tạo trình phát lần đầu, hoặc đổi video khi current đổi
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const store = usePlayerStore.getState;

    loadYouTubeAPI().then(() => {
      if (cancelled || !targetRef.current) return;
      if (playerRef.current) {
        playerRef.current.loadVideoById(current.youtubeId);
        return;
      }
      playerRef.current = new YT.Player(targetRef.current, {
        videoId: current.youtubeId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => {
            const p = e.target;
            store().setController({
              play: () => p.playVideo(),
              pause: () => p.pauseVideo(),
              seekBy: (sec) => p.seekTo(Math.max(0, p.getCurrentTime() + sec), true),
              setMuted: (m) => (m ? p.mute() : p.unMute()),
            });
          },
          onStateChange: (e) => {
            const playing = e.data === YT.PlayerState.PLAYING;
            store().setPlaying(playing);
            // Lượt xem: gửi một lần cho mỗi bài, khi bắt đầu phát thật (không phải lúc mở trang)
            const slug = store().current?.slug;
            if (playing && slug && countedRef.current !== slug) {
              countedRef.current = slug;
              api(`/media/${slug}/views`, { method: "POST" }).catch(() => {
                // Đếm lượt xem hỏng không được làm phiền người đang xem
              });
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  // Cập nhật tiến độ cho thanh đường băng, 2 lần mỗi giây khi đang phát
  const playing = usePlayerStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (p?.getCurrentTime)
        usePlayerStore.getState().setProgress(p.getCurrentTime(), p.getDuration());
    }, 500);
    return () => window.clearInterval(id);
  }, [playing]);

  // Đè khít lên slot: đo vị trí của slot, đặt trình phát (fixed) đúng chỗ đó. Đo lại khi
  // cuộn trang hoặc slot đổi kích thước. useLayoutEffect: chạy trước khi trình duyệt vẽ,
  // tránh một khung hình trình phát nằm sai chỗ.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!slot) {
      host.style.cssText = "";
      return;
    }
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = slot.getBoundingClientRect();
        host.style.cssText = `top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(slot);
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [slot]);

  return (
    <div
      ref={hostRef}
      className={cn(
        "fixed z-[80] overflow-hidden bg-black",
        !current && "hidden",
        slot
          ? "rounded-card"
          : // Ô nổi: trên thanh mini player (và thanh tab trên điện thoại)
            "bottom-[calc(theme(spacing.tabbar)_+_theme(spacing.player)_+_8px)] right-2 h-[200px] w-[min(356px,calc(100vw-16px))] rounded-card-sm shadow-lg md:bottom-[calc(theme(spacing.player)_+_12px)] md:right-4",
      )}
    >
      {/* YT.Player THAY THẾ div này bằng iframe, nên bọc nó trong một div React quản lý */}
      <div ref={targetRef} />
    </div>
  );
}
```

- **`apiReady` dùng chung một Promise**: dù gọi `loadYouTubeAPI()` bao nhiêu lần, script chỉ chèn một lần.
- **`new YT.Player(targetRef.current, ...)` THAY THẾ div đích bằng iframe**. Nên bọc div đích trong một
  div mà React quản lý (`hostRef`); React chỉ đụng tới div ngoài.
- **`loadVideoById`**: đã có trình phát thì chỉ đổi video, không tạo trình phát mới.
- **`usePlayerStore.getState()`** trong callback của YouTube: đọc state **mới nhất** lúc sự kiện xảy ra.
  Nếu dùng biến lấy từ hook lúc render, callback (tạo một lần) sẽ giữ giá trị cũ mãi (stale closure).
- **Lượt xem gửi khi bắt đầu phát thật** (`PLAYING`), không phải khi mở trang: người mở rồi đi ngay
  không bị tính.
- **`useLayoutEffect` + `requestAnimationFrame`**: đo `getBoundingClientRect()` của ô, đặt `top/left/
  width/height`. Đo lại khi cuộn (`scroll`), đổi cỡ cửa sổ (`resize`) và khi ô đổi kích thước
  (`ResizeObserver`). `requestAnimationFrame` gộp nhiều sự kiện cuộn trong cùng một khung hình thành
  một lần đo.

### Bước 5: `frontend/src/components/player/PlayerSlot.tsx`

```tsx
"use client";

import { useEffect, useRef } from "react";

import { type NowPlaying, usePlayerStore } from "@/stores/player-store";

// Ô dành chỗ cho trình phát trên trang xem. Bản thân ô này trống: YouTubeHost (trong AppShell)
// đo vị trí ô và đặt trình phát đè khít lên. Rời trang (ô bị gỡ) thì trình phát thu thành ô nổi
// và vẫn phát tiếp.
export function PlayerSlot({ media }: { media: NowPlaying }) {
  const ref = useRef<HTMLDivElement>(null);
  const play = usePlayerStore((s) => s.play);
  const setSlot = usePlayerStore((s) => s.setSlot);

  useEffect(() => {
    play(media); // đang phát đúng bài này thì play() không làm gì, video chạy tiếp
    setSlot(ref.current);
    return () => setSlot(null);
  }, [media, play, setSlot]);

  return <div ref={ref} className="aspect-video w-full rounded-card bg-black" />;
}
```

Cleanup của `useEffect` (`return () => setSlot(null)`) chạy khi rời trang: đó là lúc trình phát thu nhỏ.

### Bước 6: Mini player (viết lại) và `AppShell`

#### `frontend/src/components/layout/MiniPlayer.tsx`

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { Runway } from "@/components/player/Runway";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/stores/player-store";

// Thanh điều khiển dưới đáy trang khi đang phát mà KHÔNG ở trang xem (ở trang xem, trình phát
// YouTube đã to và có nút riêng). Hình video nằm ở ô nổi phía trên thanh này (YouTubeHost).
//
// Màn ≥ 768px: đầy đủ nút, thanh đường băng ở giữa.
// Điện thoại: nằm trên thanh tab, chỉ còn nút phát/dừng và đóng; thanh tiến độ thu thành
// vạch mảnh ở mép trên.
export function MiniPlayer() {
  const { current, playing, muted, time, duration, slot } = usePlayerStore();
  const { togglePlay, toggleMute, seekBy, close } = usePlayerStore();
  if (!current || slot) return null;

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div
      className="fixed bottom-tabbar left-0 right-0 z-[95] flex h-player items-center gap-2 bg-overlay/95 pl-2.5 pr-2 text-white shadow-[0_-10px_30px_rgb(15_23_42/0.25)] backdrop-blur-md transition-[left] duration-300 ease-brand md:bottom-0 md:left-sidebar-mini md:gap-4 md:px-4 xl:left-sidebar xl:group-data-[collapsed=true]/app:left-sidebar-mini"
      role="region"
      aria-label="Trình phát"
    >
      <Link
        href={`/${current.category}/${current.slug}`}
        className="flex min-w-0 flex-1 items-center gap-3 md:w-[280px] md:flex-none"
      >
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
      </Link>

      <div className="flex items-center gap-1">
        <PlayerButton
          label="Tua lại 10 giây"
          onClick={() => seekBy(-10)}
          className="hidden md:inline-flex"
        >
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
        <PlayerButton
          label="Tua tới 10 giây"
          onClick={() => seekBy(10)}
          className="hidden md:inline-flex"
        >
          <Icon name="forward" className="size-7" />
        </PlayerButton>
      </div>

      {/* runway--compact: điện thoại thu thành vạch mảnh ở mép trên (globals.css) */}
      <Runway
        progress={progress}
        running={playing}
        className="runway--compact md:min-w-0 md:flex-1"
      />

      <span className="hidden text-xs tabular-nums text-white/60 md:inline">
        {formatDuration(time)} / {formatDuration(duration)}
      </span>

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

Ẩn khi đang ở trang xem (`slot` có giá trị): trình phát lớn đã có nút riêng của YouTube.
`tabular-nums`: các chữ số cùng bề rộng, đồng hồ "0:11 / 22:23" không giật ngang mỗi giây.

#### `frontend/src/components/layout/AppShell.tsx`

```tsx
"use client";

import { YouTubeHost } from "@/components/player/YouTubeHost";
import { usePlayerStore } from "@/stores/player-store";
import { useUIStore } from "@/stores/ui-store";

import { Footer } from "./Footer";
import { Header } from "./Header";
import { MiniPlayer } from "./MiniPlayer";
import { SidebarDrawer, SidebarDocked, SidebarRail } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TopNav } from "./TopNav";

// Khung chung của mọi trang (thay js/layout.js của mockup).
//
// Thẻ bọc ngoài cùng mang hai thuộc tính data-*:
//   data-collapsed: người dùng thu gọn menu dọc (chỉ có tác dụng ở màn ≥ 1280px)
//   data-playing:   đang có mini player → chừa chỗ dưới đáy để nội dung không bị che
// Các phần con dùng biến thể Tailwind `group-data-[...]/app:` để đổi vị trí theo hai thuộc tính
// này, nên chỉ AppShell cần đọc store, các phần con vẫn là component tĩnh.
//
// Độ rộng menu dọc theo màn hình (Tailwind mobile-first):
//   < 768px  (mặc định): không có menu dọc, dùng thanh tab dưới đáy; ☰ mở ngăn kéo
//   768–1279 (md):       thanh icon hẹp 76px; ☰ mở ngăn kéo đầy đủ đè lên nội dung
//   ≥ 1280   (xl):       menu đầy đủ 232px; ☰ thu gọn thành thanh icon 76px
export function AppShell({ children }: { children: React.ReactNode }) {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  // Thanh mini player chỉ hiện khi đang phát và không ở trang xem (MiniPlayer.tsx)
  const hasPlayer = usePlayerStore((s) => s.current !== null && s.slot === null);

  return (
    <div className="group/app" data-collapsed={navCollapsed} data-playing={hasPlayer}>
      {/* Người dùng bàn phím/trình đọc màn hình bỏ qua menu, nhảy thẳng tới nội dung */}
      <a
        href="#noi-dung"
        className="sr-only z-[200] rounded-card-sm bg-brand-600 px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Bỏ qua menu
      </a>

      <Header />
      <TopNav />
      <SidebarRail />
      <SidebarDocked />
      <SidebarDrawer />

      <div
        className={
          // Chừa chỗ cho header + menu ngang ở trên, menu dọc bên trái, thanh tab/mini player ở dưới
          "flex min-h-screen flex-col bg-gradient-glow bg-no-repeat " +
          "pb-tabbar pt-[calc(theme(spacing.header)_+_theme(spacing.topnav))] " +
          "transition-[margin] duration-300 ease-brand " +
          "md:ml-sidebar-mini md:pb-0 xl:ml-sidebar xl:group-data-[collapsed=true]/app:ml-sidebar-mini " +
          "group-data-[playing=true]/app:pb-[calc(theme(spacing.tabbar)_+_theme(spacing.player))] " +
          "md:group-data-[playing=true]/app:pb-player"
        }
      >
        <main id="noi-dung" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>

      <YouTubeHost />
      <MiniPlayer />
      <TabBar />
    </div>
  );
}
```

Thêm `<YouTubeHost />`; `hasPlayer` chỉ đúng khi thanh mini player thật sự hiện.

### Bước 7: Trang xem

#### `frontend/src/components/watch/get-media.ts`

```ts
import { notFound } from "next/navigation";
import { cache } from "react";

import { ApiError, api } from "@/lib/api";
import type { MediaDetail } from "@/lib/types";

// cache() của React: trong CÙNG một request, gọi getMedia(slug) nhiều lần (generateMetadata và
// trang) chỉ gọi API một lần.
export const getMedia = cache(async (slug: string): Promise<MediaDetail> => {
  try {
    return await api<MediaDetail>(`/media/${encodeURIComponent(slug)}`);
  } catch (err) {
    // API trả 404 → trang 404 của Next (mã HTTP 404, dùng not-found.tsx)
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});
```

- **`notFound()`**: dừng render, Next.js trả **mã 404** và hiện `not-found.tsx`.
- **`cache()`**: `generateMetadata` (tiêu đề tab) và trang đều cần media; trong cùng một request chỉ
  gọi API một lần.

#### `frontend/src/components/watch/WatchPage.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { mediaHref, viewWord } from "@/components/media/links";
import { PlayerSlot } from "@/components/player/PlayerSlot";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { getMedia } from "./get-media";

// Trang xem / nghe một media: trình phát, thông tin, kênh, mô tả, gợi ý bên phải.
export async function WatchPage({ category, slug }: { category: "xem" | "nghe"; slug: string }) {
  const media = await getMedia(slug);
  // /nghe/<slug-của-phim> → chuyển về đúng /xem/<slug> (308), để mỗi nội dung chỉ có một URL
  if (media.category !== category) permanentRedirect(mediaHref(media));

  const related = await api<MediaCard[]>(`/media/${encodeURIComponent(slug)}/related`);

  return (
    <div className="mx-auto grid max-w-[1680px] gap-6 px-3 py-4 md:px-6 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {media.youtube_id ? (
          <PlayerSlot
            media={{
              slug: media.slug,
              category: media.category,
              title: media.title,
              channel: media.channel.name,
              thumbnail: media.thumbnail_url,
              youtubeId: media.youtube_id,
            }}
          />
        ) : (
          <NoVideo thumbnail={media.thumbnail_url} />
        )}

        <h1 className="mt-4 text-xl font-bold md:text-2xl">{media.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
          <time dateTime={media.published_at}>{timeAgo(media.published_at)}</time> ·{" "}
          {media.group_label} · {media.genre_label}
          {durationLabel(media) && ` · ${durationLabel(media)}`}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <Avatar name={media.channel.name} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-semibold">
              {media.channel.name}
              {media.channel.verified && <Icon name="check" className="size-4 text-brand-600" />}
            </p>
            {media.channel.followers_count !== undefined && (
              <p className="text-sm text-ink-muted">
                {compactNumber(media.channel.followers_count)} người theo dõi
              </p>
            )}
          </div>
          {/* Theo dõi kênh cần đăng nhập (Phần 04) */}
          <Link
            href="/dang-nhap"
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-2"
          >
            Theo dõi
          </Link>
        </div>

        <div className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-4 text-[15px] leading-relaxed">
          {media.lineup_month && (
            <p className="mb-2 text-sm font-semibold text-accent-700">
              Line-up phim tháng {media.lineup_month.split("-").reverse().join("/")}
            </p>
          )}
          {media.description || "Chưa có mô tả."}
        </div>
      </div>

      <aside aria-label="Có thể bạn thích">
        <h2 className="mb-3 font-bold">Có thể bạn thích</h2>
        <ul className="grid gap-3">
          {related.map((m) => (
            <li key={m.id}>
              <RelatedItem media={m} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function NoVideo({ thumbnail }: { thumbnail: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-overlay">
      <Image
        src={thumbnail}
        alt=""
        fill
        sizes="(min-width: 1024px) 60vw, 100vw"
        className="object-cover opacity-40"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white">
        <Icon name="screen" className="size-12 text-white/70" />
        <p className="mt-3 font-semibold">Nội dung này chưa có video</p>
        <p className="text-sm text-white/70">Video sẽ được cập nhật sớm.</p>
      </div>
    </div>
  );
}

function RelatedItem({ media }: { media: MediaCard }) {
  return (
    <Link href={mediaHref(media)} className="group flex gap-3">
      <span className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
        <Image src={media.thumbnail_url} alt="" fill sizes="160px" className="object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
          {durationLabel(media)}
        </span>
      </span>
      <span className="grid min-w-0 content-start">
        <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
          {media.title}
        </strong>
        <small className="mt-1 truncate text-ink-muted">{media.channel.name}</small>
        <small className="text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)}
        </small>
      </span>
    </Link>
  );
}
```

- **`permanentRedirect`** (308): `/nghe/vung-troi-cuoi-cung` là một phim (thuộc `xem`) → chuyển về đúng
  `/xem/vung-troi-cuoi-cung`. Mỗi nội dung một URL duy nhất (tốt cho SEO, không chia lượt chia sẻ).
- **`NoVideo`**: dữ liệu mẫu chưa có `youtube_id` → hiện ảnh mờ và thông báo, không hiện trình phát hỏng.

#### `frontend/src/app/xem/[slug]/page.tsx` (và `nghe/[slug]/page.tsx` giống hệt, đổi `"xem"` → `"nghe"`)

```tsx
import type { Metadata } from "next";

import { WatchPage } from "@/components/watch/WatchPage";
import { getMedia } from "@/components/watch/get-media";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Tiêu đề tab, mô tả và ảnh khi chia sẻ link lên Facebook/Zalo lấy theo từng media
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const media = await getMedia((await params).slug);
  return {
    title: media.title,
    description: media.description,
    openGraph: {
      title: media.title,
      description: media.description,
      images: [media.thumbnail_url],
    },
  };
}

export default async function Page({ params }: Props) {
  return <WatchPage category="xem" slug={(await params).slug} />;
}
```

`generateMetadata`: tiêu đề tab, mô tả, ảnh khi chia sẻ link lên Facebook/Zalo theo từng media.

## Kiểm tra

**Không có video** (dữ liệu mẫu): mở http://localhost:3000/xem/vung-troi-cuoi-cung → ảnh mờ "Nội dung
này chưa có video", thông tin, kênh, mô tả "Line-up phim tháng …", cột "Có thể bạn thích".

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" localhost:3000/nghe/vung-troi-cuoi-cung
# 308 http://localhost:3000/xem/vung-troi-cuoi-cung
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/xem/khong-co      # 404
```

**Có video**: gắn video mẫu của tài liệu YouTube IFrame API vào **database dev** (không sửa `data.json`):

```bash
docker compose exec postgres psql -U airlife -c \
  "UPDATE media SET youtube_id = 'M7lc1UVf-VE' WHERE slug = 'vung-troi-cuoi-cung';"
```

1. Mở `/xem/vung-troi-cuoi-cung`: trình phát YouTube nằm đúng ô, bấm phát.
2. Bấm "Home" ở menu dọc: video **phát tiếp, không tải lại**, thu thành ô nổi góc dưới phải; thanh mini
   player hiện tên phim, đồng hồ chạy (vd. `0:11 / 22:23`), thanh đường băng chạy theo.
3. Bấm tạm dừng ở mini player: video dừng, nút đổi thành "Phát". Bấm tua tới: đồng hồ nhảy 10 giây.
4. Bấm tên phim ở mini player: về trang xem, video phóng to lại đúng ô, vẫn đang ở giây cũ.
5. `make logs s=api`: có dòng `POST /api/v1/media/vung-troi-cuoi-cung/views status=204` lúc bắt đầu phát.

Muốn bỏ video thử: `UPDATE media SET youtube_id = NULL WHERE slug = 'vung-troi-cuoi-cung';`

```bash
make fe-typecheck && make fe-lint && make fe-audit
git add . && git commit -m "Trang xem, trình phát YouTube xuyên trang"
```

Đến đây xong Phần 02.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `Property 'onYouTubeIframeAPIReady' does not exist on type 'Window'` | Thiếu `src/types/youtube.d.ts` (lỗi có thật lúc làm bài này) |
| Chuyển trang thì video tải lại từ đầu | Iframe nằm trong trang thay vì trong `AppShell`, hoặc bị di chuyển trong DOM |
| Trình phát lệch khỏi ô khi cuộn | Thiếu nghe sự kiện `scroll` (tham số `passive: true` để không làm cuộn giật) |
| Video không tự phát | Trình duyệt chặn tự phát có tiếng khi người dùng chưa tương tác; bấm phát trong khung YouTube |
| Nút mini player bấm không ăn | `controller` chưa có: trình phát chưa `onReady` (mạng chậm) |
