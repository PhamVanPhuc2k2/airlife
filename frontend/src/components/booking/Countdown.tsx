"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

// Đồng hồ đếm ngược thời gian giữ chỗ. deadline: mốc hết hạn theo ĐỒNG HỒ MÁY KHÁCH, tính bằng
// lúc nhận phản hồi + expires_in (số giây server tính), nên máy khách chạy nhanh/chậm vài phút
// cũng không làm sai. Hết giờ thì gọi onExpire (tải lại đơn để thấy trạng thái "hết hạn").
export function Countdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  // Làm tròn lên (như server): chỉ hiện 00:00 khi đã thật sự hết giờ
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span
      role="timer"
      aria-label={`Còn ${Math.floor(left / 60)} phút ${left % 60} giây giữ chỗ`}
      className={cn(
        "font-mono text-2xl font-bold tabular-nums",
        left < 120 ? "text-danger" : "text-accent-700",
      )}
    >
      {mm}:{ss}
    </span>
  );
}
