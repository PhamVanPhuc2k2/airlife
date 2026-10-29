"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { compactNumber, timeAgo } from "@/lib/format";
import { type CommentTarget, repliesOptions } from "@/lib/queries";
import type { Comment } from "@/lib/types";

import { CommentComposer } from "./CommentComposer";

// Một bình luận: tên, thời gian, nội dung, thích, trả lời, xoá (của mình).
// rootId: id bình luận gốc. Trả lời một câu trả lời thì vẫn gắn vào gốc (backend cũng làm vậy).
export function CommentItem({
  comment,
  target,
  rootId,
}: {
  comment: Comment;
  target: CommentTarget;
  rootId?: string;
}) {
  const isReply = !!rootId;
  const { me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(comment.liked_by_me);
  const [likes, setLikes] = useState(comment.like_count);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const like = useMutation({
    mutationFn: (next: boolean) =>
      api<{ liked: boolean; like_count: number }>(`/comments/${comment.id}/like`, {
        method: next ? "POST" : "DELETE",
      }),
    // Lạc quan: đổi ngay, lỗi thì trả lại
    onMutate: (next) => {
      const prev = { liked, likes };
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
      return prev;
    },
    onError: (_e, _next, prev) => {
      if (prev) {
        setLiked(prev.liked);
        setLikes(prev.likes);
      }
    },
    onSuccess: (r) => {
      setLiked(r.liked);
      setLikes(r.like_count);
    },
  });

  const remove = useMutation({
    mutationFn: () => api<void>(`/comments/${comment.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comments", target.kind, target.slug] });
      if (rootId) void qc.invalidateQueries({ queryKey: ["comments", "replies", rootId] });
    },
  });

  const needLogin = () => router.push(`/dang-nhap?next=${encodeURIComponent(pathname)}`);

  return (
    <li className="flex gap-3">
      <Avatar name={comment.author.display_name} size={isReply ? "xs" : "sm"} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-sm">{comment.author.display_name}</strong>
          <time
            dateTime={comment.created_at}
            className="text-xs text-ink-muted"
            suppressHydrationWarning
          >
            {timeAgo(comment.created_at)}
          </time>
        </p>
        {/* whitespace-pre-line: giữ xuống dòng người dùng gõ. Nội dung hiện như văn bản (React tự
            escape), nên "<script>" trong bình luận chỉ là chữ */}
        <p className="mt-0.5 whitespace-pre-line break-words text-[15px]">{comment.body}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-sm text-ink-muted">
          <button
            type="button"
            onClick={() => (me ? like.mutate(!liked) : needLogin())}
            aria-pressed={liked}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 hover:bg-surface-2",
              liked && "text-brand-700",
            )}
          >
            <Icon name="like" className={cn("size-4", liked && "fill-brand-100")} />
            {compactNumber(likes)}
            <span className="sr-only">lượt thích</span>
          </button>
          <button
            type="button"
            onClick={() => (me ? setReplying((v) => !v) : needLogin())}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 hover:bg-surface-2"
          >
            <Icon name="comment" className="size-4" />
            Trả lời
          </button>
          {comment.mine && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Xoá bình luận này?")) remove.mutate();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 hover:bg-surface-2 hover:text-danger"
            >
              <Icon name="trash" className="size-4" />
              Xoá
            </button>
          )}
        </div>

        {replying && (
          <div className="mt-2">
            <CommentComposer
              target={target}
              parentId={rootId ?? comment.id}
              autoFocus
              onDone={() => {
                setReplying(false);
                setShowReplies(true);
              }}
            />
          </div>
        )}

        {!isReply && comment.reply_count > 0 && (
          <button
            type="button"
            onClick={() => setShowReplies((v) => !v)}
            aria-expanded={showReplies}
            className="mt-1 text-sm font-semibold text-brand-700"
          >
            {showReplies ? "Ẩn trả lời" : `Xem ${comment.reply_count} trả lời`}
          </button>
        )}
        {!isReply && showReplies && <Replies commentId={comment.id} target={target} />}
      </div>
    </li>
  );
}

function Replies({ commentId, target }: { commentId: string; target: CommentTarget }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    repliesOptions(commentId),
  );
  if (isPending) return <p className="mt-2 text-sm text-ink-muted">Đang tải…</p>;
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mt-3">
      <ul className="grid gap-4">
        {items.map((r) => (
          <CommentItem key={r.id} comment={r} target={target} rootId={commentId} />
        ))}
      </ul>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mt-2 text-sm font-semibold text-brand-700"
        >
          Xem thêm trả lời
        </button>
      )}
    </div>
  );
}
