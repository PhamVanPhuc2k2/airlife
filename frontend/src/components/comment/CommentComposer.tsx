"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { CommentTarget } from "@/lib/queries";
import type { Comment } from "@/lib/types";

// Ô viết bình luận / trả lời. Khách thấy lời mời đăng nhập; tài khoản chưa xác minh email thấy
// lời nhắc xác minh (backend cũng chặn, đây chỉ để người dùng biết vì sao).
export function CommentComposer({
  target,
  parentId,
  onDone,
  autoFocus = false,
}: {
  target: CommentTarget;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const { me, isLoading } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: () =>
      api<Comment>(`/${target.kind}/${target.slug}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, parent_id: parentId ?? null }),
      }),
    onSuccess: () => {
      setBody("");
      // Tải lại danh sách bình luận (mọi kiểu sắp xếp) và danh sách trả lời liên quan
      void qc.invalidateQueries({ queryKey: ["comments", target.kind, target.slug] });
      if (parentId) void qc.invalidateQueries({ queryKey: ["comments", "replies", parentId] });
      onDone?.();
    },
  });

  if (isLoading) return null;
  if (!me) {
    return (
      <p className="rounded-card-sm bg-surface-2 px-4 py-3 text-sm">
        <Link
          href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
          className="font-semibold text-brand-700"
        >
          Đăng nhập
        </Link>{" "}
        để bình luận.
      </p>
    );
  }
  if (!me.email_verified) {
    return (
      <p className="rounded-card-sm bg-warning/10 px-4 py-3 text-sm">
        Bạn cần xác minh email trước khi bình luận.{" "}
        <Link href="/ban" className="font-semibold text-brand-700">
          Gửi lại email xác minh
        </Link>
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate();
      }}
      className="flex gap-3"
    >
      <Avatar name={me.display_name} size="sm" />
      <div className="grid flex-1 gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={parentId ? "Viết trả lời…" : "Viết bình luận…"}
          aria-label={parentId ? "Viết trả lời" : "Viết bình luận"}
          maxLength={2000}
          rows={2}
          autoFocus={autoFocus}
          className="w-full resize-y rounded-card-sm bg-surface px-4 py-2.5 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-0"
        />
        {send.error instanceof ApiError && (
          <p role="alert" className="text-sm text-danger">
            {send.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="h-9 rounded-full px-4 text-sm font-semibold text-ink-muted hover:bg-surface-2"
            >
              Huỷ
            </button>
          )}
          <button
            type="submit"
            disabled={!body.trim() || send.isPending}
            className="h-9 rounded-full bg-gradient-brand px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {send.isPending ? "Đang gửi…" : "Gửi"}
          </button>
        </div>
      </div>
    </form>
  );
}
