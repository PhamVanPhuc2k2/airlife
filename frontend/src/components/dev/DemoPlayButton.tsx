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
