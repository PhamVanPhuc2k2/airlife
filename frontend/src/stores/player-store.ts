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
