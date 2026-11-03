"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { LoadMore } from "@/components/ui/LoadMore";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { experiencesOptions } from "@/lib/queries";
import type { Experience } from "@/lib/types";

import { StarPicker, Stars } from "./Stars";

// Tab "Trải nghiệm": ô đăng bài + dòng chảy bài chia sẻ, mới nhất trước.
export function ExperienceFeed() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
    useInfiniteQuery(experiencesOptions());
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <Composer />
      {isPending ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-2" />
      ) : items.length === 0 ? (
        <p className="text-ink-muted">Chưa có bài chia sẻ nào. Hãy là người đầu tiên!</p>
      ) : (
        <div className="space-y-4">
          {items.map((e) => (
            <Post key={e.id} e={e} />
          ))}
        </div>
      )}
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </div>
  );
}

function Composer() {
  const { me, isLoading } = useMe();
  const qc = useQueryClient();
  const [route, setRoute] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  const post = useMutation({
    mutationFn: () =>
      api<Experience>("/experiences", {
        method: "POST",
        body: JSON.stringify({ route, rating, body }),
      }),
    onSuccess: () => {
      setRoute("");
      setBody("");
      setRating(5);
      void qc.invalidateQueries({ queryKey: ["experiences"] });
    },
  });

  if (isLoading) return null;
  const box = "rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]";
  if (!me) {
    return (
      <p className={cn(box, "text-sm")}>
        <Link href="/dang-nhap?next=/y-kien/trai-nghiem" className="font-semibold text-brand-700">
          Đăng nhập
        </Link>{" "}
        để chia sẻ chuyến bay của bạn.
      </p>
    );
  }
  if (!me.email_verified) {
    return (
      <p className={cn(box, "text-sm")}>
        Bạn cần xác minh email trước khi đăng bài.{" "}
        <Link href="/ban" className="font-semibold text-brand-700">
          Gửi lại email xác minh
        </Link>
      </p>
    );
  }

  const fields = post.error instanceof ApiError ? post.error.fields : undefined;
  const message = post.error instanceof ApiError && !fields ? post.error.message : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        post.mutate();
      }}
      className={cn(box, "space-y-3")}
    >
      <div className="flex gap-3">
        <Avatar name={me.display_name} size="sm" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <label htmlFor="exp-body" className="sr-only">
            Chuyến bay vừa rồi của bạn thế nào?
          </label>
          <textarea
            id="exp-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            placeholder="Chuyến bay vừa rồi của bạn thế nào?"
            aria-invalid={fields?.body ? true : undefined}
            className="w-full resize-y rounded-card-sm bg-surface-2 px-3 py-2 ring-1 ring-transparent focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {fields?.body && <p className="text-sm text-danger">{fields.body}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3 pl-12">
        <div className="grid gap-1">
          <label htmlFor="exp-route" className="sr-only">
            Chặng bay
          </label>
          <input
            id="exp-route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            maxLength={40}
            placeholder="Chặng bay, VD: SGN → HAN"
            aria-invalid={fields?.route ? true : undefined}
            className="h-10 w-56 rounded-full bg-surface-2 px-4 ring-1 ring-transparent focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {fields?.route && <p className="text-sm text-danger">{fields.route}</p>}
        </div>
        <StarPicker value={rating} onChange={setRating} />
        <button
          type="submit"
          disabled={post.isPending}
          className="ml-auto h-10 rounded-full bg-gradient-brand px-6 font-semibold text-white shadow-brand disabled:opacity-60"
        >
          {post.isPending ? "Đang đăng…" : "Đăng"}
        </button>
      </div>
      {message && (
        <p role="alert" className="pl-12 text-sm text-danger">
          {message}
        </p>
      )}
    </form>
  );
}

function Post({ e }: { e: Experience }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(e.liked_by_me);
  const [likes, setLikes] = useState(e.like_count);

  const like = useMutation({
    mutationFn: (next: boolean) =>
      api<{ liked: boolean; like_count: number }>(`/experiences/${e.id}/like`, {
        method: next ? "POST" : "DELETE",
      }),
    // Lạc quan: đổi ngay, lỗi thì trả lại
    onMutate: (next) => {
      const prev = { liked, likes };
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
      return prev;
    },
    onError: (_err, _next, prev) => {
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
    mutationFn: () => api<void>(`/experiences/${e.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["experiences"] }),
  });

  return (
    <article className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]">
      <header className="flex items-center gap-3">
        <Avatar name={e.author.display_name} size="sm" />
        <div className="min-w-0 flex-1">
          <strong className="block truncate">{e.author.display_name}</strong>
          <time dateTime={e.created_at} className="text-xs text-ink-muted" suppressHydrationWarning>
            {timeAgo(e.created_at)}
          </time>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
          <Icon name="plane" className="size-4" />
          {e.route}
        </span>
      </header>
      <Stars value={e.rating} />
      {/* Hiện như văn bản (React tự escape), giữ xuống dòng người dùng gõ */}
      <p className="whitespace-pre-line break-words">{e.body}</p>
      <footer className="flex items-center gap-4 text-sm text-ink-muted">
        <button
          type="button"
          disabled={!me || like.isPending}
          onClick={() => like.mutate(!liked)}
          aria-pressed={liked}
          title={me ? undefined : "Đăng nhập để thích"}
          className={cn(
            "inline-flex items-center gap-1.5 font-semibold",
            liked ? "text-brand-700" : "hover:text-ink",
          )}
        >
          <Icon name="like" className={cn("size-4", liked && "fill-current")} />
          {likes}
        </button>
        {e.mine && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Xoá bài chia sẻ này?")) remove.mutate();
            }}
            disabled={remove.isPending}
            className="ml-auto inline-flex items-center gap-1.5 hover:text-danger"
          >
            <Icon name="trash" className="size-4" />
            Xoá
          </button>
        )}
      </footer>
    </article>
  );
}
