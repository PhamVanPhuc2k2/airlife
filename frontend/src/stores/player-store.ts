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
