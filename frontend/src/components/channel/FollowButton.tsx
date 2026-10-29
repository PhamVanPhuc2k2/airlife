"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";
import type { ChannelDetail } from "@/lib/types";

type FollowState = { following: boolean; followers_count: number };

// Nút Theo dõi kèm số người theo dõi.
//
// Server dựng trang KHÔNG có cookie của khách (bài 2.08), nên không biết khách đã theo dõi chưa:
// initial luôn "chưa theo dõi". Ở trình duyệt, nếu đã đăng nhập thì hỏi lại API (có cookie) để
// lấy trạng thái thật. initialDataUpdatedAt: 0 = coi dữ liệu ban đầu là cũ, tải lại ngay.
export function FollowButton({
  slug,
  initial,
  compact = false,
}: {
  slug: string;
  initial: FollowState;
  compact?: boolean;
}) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();
  const key = ["channel", slug, "follow"];

  const { data: state = initial } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<FollowState> => {
      const c = await api<ChannelDetail>(`/channels/${slug}`);
      return { following: c.following, followers_count: c.followers_count };
    },
    initialData: initial,
    initialDataUpdatedAt: 0,
    enabled: !!me,
  });

  const toggle = useMutation({
    mutationFn: (follow: boolean) =>
      api<FollowState>(`/channels/${slug}/follow`, { method: follow ? "POST" : "DELETE" }),
    // Cập nhật lạc quan (optimistic): đổi nút NGAY khi bấm, không chờ API. Lỗi thì trả lại như cũ.
    onMutate: async (follow) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<FollowState>(key);
      qc.setQueryData<FollowState>(key, (s = initial) => ({
        following: follow,
        followers_count: s.followers_count + (follow ? 1 : -1),
      }));
      return { prev };
    },
    onError: (_err, _follow, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: (s) => qc.setQueryData(key, s),
    // Danh sách "Kênh đang theo dõi" ở menu dọc đổi theo
    onSettled: () => qc.invalidateQueries({ queryKey: ["me", "following"] }),
  });

  const count = (
    <span className="text-sm text-ink-muted">
      {compactNumber(state.followers_count)} người theo dõi
    </span>
  );
  const button = !me ? (
    <Link
      href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
      className={buttonClass(false, compact)}
    >
      Theo dõi
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => toggle.mutate(!state.following)}
      aria-pressed={state.following}
      className={buttonClass(state.following, compact)}
    >
      {state.following ? "Đang theo dõi" : "Theo dõi"}
    </button>
  );

  if (compact) return button;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {button}
      {count}
    </div>
  );
}

function buttonClass(following: boolean, compact: boolean) {
  return cn(
    "inline-flex items-center justify-center rounded-full font-semibold transition",
    compact ? "h-9 px-4 text-sm" : "h-10 px-5",
    following ? "bg-surface-2 text-ink-2 hover:bg-surface-3" : "bg-ink text-white hover:bg-ink-2",
  );
}
