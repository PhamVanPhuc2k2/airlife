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
