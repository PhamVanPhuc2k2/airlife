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
