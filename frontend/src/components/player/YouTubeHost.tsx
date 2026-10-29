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
