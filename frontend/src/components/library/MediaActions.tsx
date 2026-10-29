"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { mediaStateKey, useInvalidateLibrary, useMediaState } from "@/lib/library";
import type { MediaState } from "@/lib/types";

import { PlaylistDialog } from "./PlaylistDialog";

const pill =
  "inline-flex h-9 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold text-ink-2 transition hover:bg-surface-3";

// Nút "Lưu" và "Playlist" ở trang xem. Khách thấy link đăng nhập (như nút Theo dõi).
export function MediaActions({ slug, title }: { slug: string; title: string }) {
  const { me } = useMe();
  const pathname = usePathname();
  const [dialog, setDialog] = useState(false);

  if (!me) {
    const href = `/dang-nhap?next=${encodeURIComponent(pathname)}`;
    return (
      <div className="flex flex-wrap gap-2">
        <Link href={href} className={pill}>
          <Icon name="bookmark" className="size-4" />
          Lưu
        </Link>
        <Link href={href} className={pill}>
          <Icon name="plus" className="size-4" />
          Playlist
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <SaveButton slug={slug} />
      <button type="button" onClick={() => setDialog(true)} className={pill}>
        <Icon name="plus" className="size-4" />
        Playlist
      </button>
      {/* Chỉ dựng hộp thoại khi mở: danh sách playlist chỉ tải khi cần */}
      {dialog && <PlaylistDialog slug={slug} title={title} onClose={() => setDialog(false)} />}
    </div>
  );
}

function SaveButton({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const { data } = useMediaState(slug);
  const saved = data?.saved ?? false;

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api<void>(`/me/saved/${slug}`, { method: next ? "PUT" : "DELETE" }),
    // Lạc quan: đổi nút ngay, lỗi thì trả lại (như nút Theo dõi, bài 5.06)
    onMutate: async (next) => {
      const key = mediaStateKey(slug);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MediaState>(key);
      if (prev) qc.setQueryData<MediaState>(key, { ...prev, saved: next });
      return { prev };
    },
    onError: (_e, _next, ctx) => qc.setQueryData(mediaStateKey(slug), ctx?.prev),
    onSettled: () => invalidate(slug),
  });

  return (
    <button
      type="button"
      onClick={() => toggle.mutate(!saved)}
      aria-pressed={saved}
      disabled={!data}
      className={cn(pill, saved && "bg-brand-50 text-brand-700 hover:bg-brand-100")}
    >
      <Icon name="bookmark" className={cn("size-4", saved && "fill-current")} />
      {saved ? "Đã lưu" : "Lưu"}
    </button>
  );
}
