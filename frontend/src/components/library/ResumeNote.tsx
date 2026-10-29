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
