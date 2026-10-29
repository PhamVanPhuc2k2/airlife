# Bài 6.03: Ghi tiến độ xem từ trình phát, xem tiếp từ chỗ dừng

> [← Bài trước](02-module-thu-vien.md) · [Mục lục](../README.md) · [Bài sau →](04-nut-luu-va-playlist.md)

## Mục tiêu

- Trình phát YouTube tự gửi tiến độ: 15 giây một lần khi đang phát, và ngay khi dừng, hết bài, đổi bài,
  đóng tab.
- Mở lại một phim đang xem dở thì tự tua tới chỗ cũ, kèm nút "Xem từ đầu".

## Bạn sẽ học

- Chọn tần suất ghi: đánh đổi giữa "mất bao nhiêu tiến độ" và "bao nhiêu request".
- `fetch(..., { keepalive: true })`: request vẫn đi khi tab đang đóng.
- `useEffectEvent` (React 19.2+): hàm luôn đọc giá trị mới nhất mà không làm effect chạy lại.
- Cleanup của effect "nhớ" giá trị của lần render cũ, và dùng điều đó để ghi đúng bài cũ.
- Đặt trạng thái dùng chung vào store Zustand thay vì `setState` trong effect.

## Viết code

### Bước 1: Kiểu dữ liệu và hook, `frontend/src/lib/types.ts`, `frontend/src/lib/library.ts`

Thêm vào cuối `types.ts` các kiểu của thư viện (và mở rộng `ChannelBrief`). Bản đầy đủ:

```ts
// Kiểu dữ liệu API trả về. Khớp với DTO bên Go (backend/internal/media/dto.go,
// internal/category, internal/home). Đổi bên Go thì sửa ở đây.

export type Category = {
  slug: string;
  name: string;
  icon: string;
  title: string;
  description: string;
  filters?: { slug: string; name: string }[];
};

export type Channel = {
  slug: string;
  name: string;
  verified: boolean;
  followers_count?: number;
};

export type MediaCard = {
  id: string;
  slug: string;
  kind: "video" | "audio";
  category: string;
  title: string;
  description?: string;
  group_label: string;
  genre_label: string;
  youtube_id: string | null;
  thumbnail_url: string;
  duration_seconds: number | null;
  episode_count: number | null;
  view_count: number;
  featured: boolean;
  published_at: string;
  channel: Channel;
};

export type MediaDetail = MediaCard & {
  tags: string[];
  category_name: string;
  lineup_month: string | null;
};

export type MediaPage = {
  items: MediaCard[];
  next_cursor?: string;
};

export type Home = {
  featured: MediaCard | null;
  latest: MediaCard[];
  trending: MediaCard[];
  top_listen: MediaCard[];
  hot_comments: { top: HotComment[]; replied: HotComment[] };
};

export type NewsCategory = {
  slug: string;
  name: string;
  description: string;
};

export type NewsCard = {
  id: string;
  slug: string;
  category: string;
  category_name: string;
  title: string;
  excerpt: string;
  cover_url: string;
  author: string;
  published_at: string;
};

// body_html đã được backend lọc bằng bluemonday trước khi lưu (backend/pkg/sanitize)
export type Article = NewsCard & {
  body_html: string;
  updated_at: string;
};

export type NewsPage = {
  items: NewsCard[];
  next_cursor?: string;
};

// Tài khoản đang đăng nhập (GET /auth/me). Khớp backend/internal/auth/service.go: User
export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "creator" | "business" | "editor" | "admin";
  email_verified: boolean;
  created_at: string;
};

// Trang kênh (GET /channels/{slug}). following: người đang xem có theo dõi không
export type ChannelDetail = {
  slug: string;
  name: string;
  type: "distributor" | "creator" | "business" | "travel";
  verified: boolean;
  followers_count: number;
  description: string;
  avatar_url: string | null;
  media_count: number;
  following: boolean;
};

// Kênh trong danh sách "Kênh đang theo dõi" (GET /me/following)
export type ChannelBrief = {
  slug: string;
  name: string;
  type: ChannelDetail["type"];
  verified: boolean;
  followers_count: number;
  avatar_url: string | null;
};

export type Comment = {
  id: string;
  author: { id: string; display_name: string; avatar_url: string | null };
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  liked_by_me: boolean;
  mine: boolean;
};

export type CommentPage = { items: Comment[]; next_cursor?: string };

export type HotComment = Comment & { media: { slug: string; category: string; title: string } };

// Thư viện cá nhân (Phần 06) ------------------------------------------------------------------

// Đã xem tới giây thứ position trên tổng duration giây
export type Progress = { position: number; duration: number };

// Media trong thư viện. progress chỉ có ở lịch sử xem / tiếp tục xem
export type LibraryItem = MediaCard & { progress?: Progress };

export type LibraryPage = { items: LibraryItem[]; next_cursor?: string };

// GET /me/media/{slug}: trạng thái của một media với người đang xem
export type MediaState = { saved: boolean; progress: Progress | null; playlist_ids: string[] };

export type LibraryStats = { following: number; saved: number; playlists: number; watched: number };

export type Playlist = {
  id: string;
  name: string;
  item_count: number;
  updated_at: string;
  first?: { slug: string; category: string; thumbnail_url: string };
};

export type PlaylistDetail = Playlist & { items: LibraryItem[] };
```

`frontend/src/lib/library.ts`: key truy vấn và hook dùng chung cho trang xem, trang Bạn, Sưu tập:

```ts
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useMe } from "./auth";
import type { MediaState, Playlist } from "./types";

// Thư viện cá nhân ở trình duyệt: trạng thái một media (đã lưu, xem tới đâu, trong playlist
// nào) và danh sách playlist. Chỉ gọi API khi đã đăng nhập.

export const mediaStateKey = (slug: string) => ["me", "media", slug] as const;
export const playlistsKey = ["me", "playlists"] as const;
export const playlistKey = (id: string) => ["me", "playlist", id] as const;

export function useMediaState(slug: string) {
  const { me } = useMe();
  return useQuery({
    queryKey: mediaStateKey(slug),
    queryFn: () => api<MediaState>(`/me/media/${slug}`),
    enabled: !!me,
  });
}

export function usePlaylists(enabled = true) {
  const { me } = useMe();
  return useQuery({
    queryKey: playlistsKey,
    queryFn: () => api<Playlist[]>("/me/playlists"),
    enabled: !!me && enabled,
  });
}

// Sau khi lưu / thêm vào playlist / xem: làm mới mọi danh sách của thư viện. Key "me" chung
// tiền tố, nhưng KHÔNG làm mới ["me","following"] hay thông tin tài khoản thì không cần;
// liệt kê rõ từng key cho dễ đọc.
export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return (slug?: string) => {
    for (const key of [
      ["me", "stats"],
      ["me", "saved"],
      ["me", "history"],
      ["me", "continue"],
      ["me", "playlists"],
      ["me", "playlist"],
    ]) {
      void qc.invalidateQueries({ queryKey: key });
    }
    if (slug) void qc.invalidateQueries({ queryKey: mediaStateKey(slug) });
  };
}
```

- **Mọi key bắt đầu bằng `"me"`**: `useLogout` (bài 4.06) xoá sạch cache khi đăng xuất, nên dữ liệu riêng
  không sót lại cho người dùng sau trên cùng máy.
- **`useInvalidateLibrary`**: lưu, thêm playlist hay xem xong đều làm số liệu ở nhiều chỗ đổi theo (số "Đã
  lưu" ở trang Bạn, tab Đã xem…). Gom việc làm mới vào một hàm để không sót chỗ nào.

### Bước 2: Lệnh tua và trạng thái "xem tiếp", `frontend/src/stores/player-store.ts`

Thêm `seekTo` vào `PlayerController`, thêm `resumedAt`, `resume`, `restart` vào store. Bản đầy đủ:

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
  seekTo: (seconds: number) => void;
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
  resumedAt: number | null; // đã tự tua tới giây này (xem tiếp từ lần trước), để hiện "Xem từ đầu"

  play: (item: NowPlaying) => void;
  togglePlay: () => void;
  toggleMute: () => void;
  seekBy: (seconds: number) => void;
  close: () => void;
  resume: (seconds: number) => void;
  restart: () => void;

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
  resumedAt: null,

  play: (item) => {
    if (get().current?.slug === item.slug) return; // đang phát đúng bài này rồi
    set({ current: item, playing: true, time: 0, duration: 0, resumedAt: null });
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
    set({ current: null, playing: false, time: 0, duration: 0, resumedAt: null });
  },
  resume: (seconds) => {
    get().controller?.seekTo(seconds);
    set({ resumedAt: seconds });
  },
  restart: () => {
    get().controller?.seekTo(0);
    set({ resumedAt: null });
  },

  setSlot: (el) => set({ slot: el }),
  setController: (c) => set({ controller: c }),
  setPlaying: (playing) => set({ playing }),
  setProgress: (time, duration) => set({ time, duration }),
}));
```

`play()` và `close()` đặt `resumedAt: null`: sang bài khác thì dòng "Đang xem tiếp từ…" biến mất.

### Bước 3: Gửi tiến độ, `frontend/src/components/player/YouTubeHost.tsx`

Bản đầy đủ:

```tsx
"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";

import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useInvalidateLibrary } from "@/lib/library";
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

// Ghi tiến độ xem mỗi 15 giây khi đang phát (và ngay khi dừng, hết bài, đổi bài, đóng tab).
// 15 giây: mất tối đa 15 giây tiến độ nếu trình duyệt tắt đột ngột, đổi lại mỗi người xem chỉ
// tạo 4 request mỗi phút.
const PROGRESS_EVERY_MS = 15_000;

export function YouTubeHost() {
  const current = usePlayerStore((s) => s.current);
  const slot = usePlayerStore((s) => s.slot);
  const playing = usePlayerStore((s) => s.playing);
  const hostRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const countedRef = useRef<string | null>(null); // slug đã gửi lượt xem
  const { me } = useMe();
  const invalidateLibrary = useInvalidateLibrary();

  // Gửi tiến độ của bài đang phát. useEffectEvent: hàm luôn đọc giá trị mới nhất (me) mà không
  // phải đưa vào danh sách phụ thuộc của các effect gọi nó, nên timer và listener không bị tạo
  // lại mỗi lần render. keepalive: request vẫn đi khi tab đang đóng.
  // slug: mặc định là bài đang phát; lúc đổi bài thì truyền slug của bài CŨ (store đã sang bài mới).
  const report = useEffectEvent(
    ({
      slug = usePlayerStore.getState().current?.slug,
      refresh = false,
      keepalive = false,
    }: { slug?: string; refresh?: boolean; keepalive?: boolean } = {}) => {
      const p = playerRef.current;
      if (!me || !p?.getCurrentTime || !slug) return;
      const position = Math.floor(p.getCurrentTime());
      const duration = Math.floor(p.getDuration());
      if (duration <= 0 || position <= 0) return; // chưa phát giây nào
      api(`/me/history/${slug}`, {
        method: "PUT",
        body: JSON.stringify({ position, duration }),
        keepalive,
      })
        .then(() => refresh && invalidateLibrary(slug))
        .catch(() => {
          // Ghi tiến độ hỏng không được làm phiền người đang xem
        });
    },
  );

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
              seekTo: (sec) => p.seekTo(sec, true),
              setMuted: (m) => (m ? p.mute() : p.unMute()),
            });
          },
          onStateChange: (e) => {
            const playing = e.data === YT.PlayerState.PLAYING;
            store().setPlaying(playing);
            // Dừng hoặc hết bài: ghi tiến độ ngay và làm mới "Tiếp tục xem", "Đã xem"
            if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
              report({ refresh: true });
            }
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

  // Đổi sang bài khác (hoặc đóng trình phát): ghi tiến độ của bài cũ. Cleanup chạy trước khi
  // trình phát nạp bài mới, nên getCurrentTime() vẫn là của bài cũ; slug lấy từ biến current mà
  // cleanup này "nhớ", vì store lúc đó đã là bài mới.
  useEffect(() => {
    if (!current) return;
    const slug = current.slug;
    return () => report({ slug, refresh: true });
  }, [current]);

  // Khi đang phát: ghi tiến độ định kỳ. Đóng tab / chuyển app trên điện thoại: ghi lần cuối.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => report(), PROGRESS_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") report({ keepalive: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [playing]);

  // Cập nhật tiến độ cho thanh đường băng, 2 lần mỗi giây khi đang phát
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

- **15 giây**: tắt trình duyệt đột ngột thì mất tối đa 15 giây tiến độ; mỗi người xem chỉ tạo 4 request
  mỗi phút. Ghi mỗi giây thì tiến độ chính xác hơn nhưng gấp 15 lần request mà người xem không thấy khác gì.
- **Ghi ngay khi `PAUSED`, `ENDED`** và làm mới thư viện (`refresh: true`): bấm dừng rồi mở trang Bạn là
  thấy ngay trong "Tiếp tục xem".
- **`visibilitychange` → `hidden`**: đóng tab, chuyển app trên điện thoại. Lúc này trang có thể bị tắt ngay;
  `keepalive: true` báo trình duyệt gửi nốt request dù trang đã đóng.
- **Đổi bài**: effect phụ thuộc `current` có cleanup chạy **trước** khi bài mới được nạp, nên
  `getCurrentTime()` vẫn là của bài cũ. Nhưng lúc đó store đã sang bài mới, nên slug phải lấy từ biến
  `current` mà cleanup "nhớ" (xem "Hay gặp lỗi").
- **`useEffectEvent`**: `report` đọc `me` mới nhất mà không phải đưa vào danh sách phụ thuộc, nên timer 15
  giây không bị tạo lại mỗi lần render. Hàm này chỉ được gọi trong effect hoặc trong callback mà effect tạo
  ra (timer, listener, `onStateChange` của YouTube), không gọi lúc render.

### Bước 4: Xem tiếp, `frontend/src/components/library/ResumeNote.tsx`

```tsx
"use client";

import { useEffect, useRef } from "react";

import { formatDuration } from "@/lib/format";
import { useMediaState } from "@/lib/library";
import { usePlayerStore } from "@/stores/player-store";

// Xem tiếp từ chỗ dừng (trang xem). Lần trước xem dở (qua 30 giây đầu, chưa tới 5% cuối, cùng
// ngưỡng với "Tiếp tục xem" ở backend) thì tua tới đó, và hiện dòng "Xem từ đầu" để quay lại.
//
// Chỉ tua khi trình phát vừa bắt đầu bài này (chưa qua 5 giây). Đang nghe ở ô nổi rồi mở lại
// trang xem thì video đang chạy tiếp, không được kéo về chỗ cũ.
export function ResumeNote({ slug }: { slug: string }) {
  const { data } = useMediaState(slug);
  const ready = usePlayerStore((s) => !!s.controller && s.current?.slug === slug);
  const resumedAt = usePlayerStore((s) => (s.current?.slug === slug ? s.resumedAt : null));
  const resume = usePlayerStore((s) => s.resume);
  const restart = usePlayerStore((s) => s.restart);
  const doneRef = useRef(false); // mỗi lần mở trang chỉ tua một lần

  const position = data?.progress?.position ?? 0;
  const duration = data?.progress?.duration ?? 0;
  const resumable = position >= 30 && position < duration * 0.95;

  useEffect(() => {
    if (doneRef.current || !resumable || !ready) return;
    doneRef.current = true;
    if (usePlayerStore.getState().time <= 5) resume(position);
  }, [resumable, ready, position, resume]);

  if (resumedAt === null) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
      Đang xem tiếp từ {formatDuration(resumedAt)}.
      <button type="button" onClick={restart} className="font-semibold text-brand-700">
        Xem từ đầu
      </button>
    </p>
  );
}
```

- **Chỉ tua khi trình phát chưa qua 5 giây**: đang nghe ở ô nổi rồi mở lại trang xem thì video đang chạy
  tiếp, không được kéo về chỗ cũ.
- **`doneRef`**: mỗi lần mở trang chỉ tua một lần; bấm "Xem từ đầu" xong không bị tua lại.

Gắn vào `frontend/src/components/watch/WatchPage.tsx`, ngay dưới trình phát (bài 6.04 có bản đầy đủ):

```tsx
        {media.youtube_id && <ResumeNote slug={media.slug} />}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

Cần một media có `youtube_id` (seed chưa có video thật). Gắn tạm video mẫu của YouTube cho một phim khi dev:

```bash
make psql
```

```sql
UPDATE media SET youtube_id = 'M7lc1UVf-VE' WHERE slug = 'vung-troi-cuoi-cung';
```

| Làm gì | Thấy gì |
|---|---|
| Đăng nhập, mở `/xem/vung-troi-cuoi-cung`, xem quá 30 giây, bấm dừng | DevTools → Network: `PUT /me/history/vung-troi-cuoi-cung` trả `204` |
| Tải lại trang | Video tự tua tới chỗ đã dừng, dòng "Đang xem tiếp từ 0:35. Xem từ đầu" |
| Bấm "Xem từ đầu" | Video về 0:00, dòng chữ biến mất |
| Đang phát, chuyển sang trang chủ (ô nổi), đợi 15 giây | Có thêm `PUT` (ghi định kỳ) |
| Đăng xuất rồi xem | Không có `PUT` nào |

Khi thử bằng script: ghi sẵn `{"position":600,"duration":5400}` rồi mở trang thì thấy "Đang xem tiếp từ
10:00"; tạm dừng sau khoảng 15 giây, `GET /me/media/vung-troi-cuoi-cung` trả
`"progress":{"position":615,"duration":1344}`. `1344` là thời lượng thật của video mẫu, thay cho số 5400 ghi
tay.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| ESLint `react-hooks/refs`: `Cannot update ref during render` | Bản đầu gán `reportRef.current = (...) => {...}` ngay trong thân component (mẫu "latest ref" cũ). React 19 cấm đọc/ghi ref lúc render; dùng `useEffectEvent` |
| ESLint `react-hooks/set-state-in-effect` ở `ResumeNote` | Bản đầu gọi `setResumedAt(...)` trong effect, làm render thêm một lần. Chuyển trạng thái vào store (`resume`) vì đằng nào cũng phải gọi trình phát |
| Đổi sang phim B thì tiến độ của phim A bị ghi cho phim B | Cleanup lấy slug từ store (đã là B). Lấy slug từ biến `current` của lần render cũ |
| Mở lại trang thì video nhảy về chỗ cũ dù đang nghe dở ở ô nổi | Thiếu điều kiện `time <= 5` |
