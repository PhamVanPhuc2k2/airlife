# Bài 5.07: Frontend: khung bình luận

> [← Bài trước](06-frontend-kenh-va-theo-doi.md) · [Mục lục](../README.md) · [Bài sau →](08-binh-luan-noi-bat-va-menu.md)

## Mục tiêu

Khung bình luận ở cuối trang xem và trang bài viết: sắp xếp Hay/Mới, tải thêm, viết bình luận, trả lời,
thích, xoá bình luận của mình.

## Bạn sẽ học

- Lấy bình luận ở trình duyệt (cần cookie cho `liked_by_me`, `mine`), không prefetch ở server.
- Tách component theo việc: khung (danh sách), một bình luận, ô nhập.
- Ba trạng thái của ô nhập: khách, chưa xác minh email, được viết.
- `invalidateQueries` theo tiền tố key: làm mới cả hai kiểu sắp xếp một lúc.

## Viết code

### Bước 1: Icon

Thêm 4 icon vào `LINE_ICONS` trong `frontend/src/components/icons/Icon.tsx`, sau `check`:

```tsx
  like: (
    <path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7" />
  ),
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  fire: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
```

### Bước 2: Ô nhập, `frontend/src/components/comment/CommentComposer.tsx`

```tsx
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
```

- **Khách** thấy link đăng nhập; **chưa xác minh** thấy lời nhắc dẫn tới trang Bạn (nút "Gửi lại email xác
  minh" ở bài 4.12). Backend vẫn chặn (`email_not_verified`); frontend chỉ giúp khách khỏi gõ xong mới biết.
- **`maxLength={2000}`** khớp giới hạn của backend.
- **Gửi xong làm mới `["comments", kind, slug]`**: key đầy đủ là `["comments", kind, slug, sort]`, TanStack
  Query so khớp theo tiền tố nên cả tab "Hay" và "Mới" đều được làm mới.

### Bước 3: Một bình luận, `frontend/src/components/comment/CommentItem.tsx`

```tsx
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
```

- **Thích dùng `useState` cục bộ**, không sửa bộ nhớ đệm của danh sách: bình luận nằm trong trang thứ mấy
  của `useInfiniteQuery` thì phải tìm và sửa lồng nhiều lớp. Lạc quan như nút Theo dõi (bài 5.06).
- **`parentId={rootId ?? comment.id}`**: trả lời một câu trả lời thì gửi id bình luận gốc, cùng cách làm
  với backend (bài 5.03).
- **Nội dung hiện bằng `{comment.body}`** với `whitespace-pre-line`: React tự escape, nên ai gõ
  `<script>` cũng chỉ hiện ra chữ. Không dùng `dangerouslySetInnerHTML` cho bình luận.
- **`Replies`** chỉ gọi API khi bấm "Xem n trả lời" (component chỉ được dựng lúc đó).

### Bước 4: Khung bình luận, `frontend/src/components/comment/CommentSection.tsx`

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LoadMore } from "@/components/ui/LoadMore";
import { cn } from "@/lib/cn";
import { type CommentTarget, commentsOptions } from "@/lib/queries";

import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";

// Khung bình luận dưới video / bài viết. Lấy hoàn toàn ở trình duyệt (có cookie): mỗi người thấy
// khác nhau (đã thích chưa, bình luận nào của mình), và bình luận không cần cho SEO.
// Sắp xếp để trong useState, không đưa lên URL: không ai cần chia sẻ link "bình luận sắp theo Mới".
export function CommentSection({ target }: { target: CommentTarget }) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    commentsOptions(target, sort),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="binh-luan" className="mt-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="binh-luan" className="text-lg font-bold">
          Bình luận
        </h2>
        <div
          role="group"
          aria-label="Sắp xếp"
          className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold"
        >
          {(["top", "new"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={cn(
                "rounded-full px-3 py-1",
                sort === s
                  ? "bg-surface text-brand-700 shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {s === "top" ? "Hay" : "Mới"}
            </button>
          ))}
        </div>
      </div>

      <CommentComposer target={target} />

      {isPending ? (
        <p className="text-sm text-ink-muted">Đang tải bình luận…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">Chưa có bình luận. Hãy là người đầu tiên!</p>
      ) : (
        <ul className="grid gap-5">
          {items.map((c) => (
            <CommentItem key={c.id} comment={c} target={target} />
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </section>
  );
}
```

### Bước 5: Gắn vào trang

Trang xem đã gắn ở bài 5.06. Trang bài viết, `frontend/src/components/news/ArticlePage.tsx`, thêm import
và đặt ngay sau thân bài, trong `<article>`:

```tsx
import { CommentSection } from "@/components/comment/CommentSection";
```

```tsx
        <CommentSection target={{ kind: "news", slug: article.slug }} />
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Chưa đăng nhập, mở http://localhost:3000/xem/vung-troi-cuoi-cung | Bình luận mẫu của Minh Anh; ô nhập là dòng "Đăng nhập để bình luận." (chữ "Đăng nhập" là link) |
| Bấm "Xem 2 trả lời" | Hai trả lời hiện bên dưới, nút đổi thành "Ẩn trả lời" |
| Đăng nhập tài khoản **chưa** xác minh | Lời nhắc xác minh email thay cho ô nhập |
| Tài khoản đã xác minh, gõ `<b>thử</b>` rồi gửi | Hiện đúng chữ `<b>thử</b>`, không in đậm; có nút "Xoá" |
| Bấm thích | Số tăng ngay, nút đổi màu (`aria-pressed="true"`) |
| Trả lời một câu trả lời | Câu mới nằm cùng danh sách trả lời của bình luận gốc |
| Đổi "Hay" ↔ "Mới" | Đổi thứ tự |
| Mở một bài trong `/tin-tuc` | Khung bình luận ở cuối bài |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Gửi bình luận xong danh sách không đổi | Key làm mới không khớp tiền tố của `commentsOptions` |
| Bình luận chứa HTML bị in đậm | Đang dùng `dangerouslySetInnerHTML`; bỏ đi |
