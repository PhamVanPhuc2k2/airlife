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
