# Bài 6.04: Nút Lưu và hộp thoại playlist ở trang xem

> [← Bài trước](03-ghi-tien-do-xem.md) · [Mục lục](../README.md) · [Bài sau →](05-trang-ban.md)

## Mục tiêu

- Trang xem có nút "Lưu" / "Đã lưu" và nút "Playlist" mở hộp thoại: tích để thêm, bỏ tích để bớt, tạo
  playlist mới ngay trong hộp thoại.
- Thẻ media có vạch tiến độ và chỗ cho một nút thao tác (dùng ở bài 6.06).

## Bạn sẽ học

- Hộp thoại có trợ năng bằng Radix Dialog: khoá focus, Esc để đóng, trả focus về nút đã mở.
- Chỉ dựng (và tải dữ liệu cho) hộp thoại khi mở.
- Một component, hai giao diện: khách và người đã đăng nhập.

## Viết code

### Bước 1: Icon

Thêm vào `LINE_ICONS` trong `frontend/src/components/icons/Icon.tsx`, sau `fire`:

```tsx
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
```

### Bước 2: `frontend/src/components/library/MediaActions.tsx`

```tsx
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
```

- **Khách thấy link**, không phải nút bị khoá: bấm vào là sang đăng nhập rồi quay lại đúng trang.
- **`disabled={!data}`** cho nút Lưu: chưa biết đã lưu hay chưa thì chưa cho bấm, tránh gửi ngược trạng thái.
- **`{dialog && <PlaylistDialog />}`**: hộp thoại chỉ được dựng khi mở, nên danh sách playlist chỉ tải khi
  người dùng cần.

### Bước 3: `frontend/src/components/library/PlaylistDialog.tsx`

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { ApiError, api } from "@/lib/api";
import { useInvalidateLibrary, useMediaState, usePlaylists } from "@/lib/library";
import type { Playlist } from "@/lib/types";

// Hộp thoại "Thêm vào playlist": tích / bỏ tích từng playlist, hoặc tạo playlist mới (tạo xong
// thêm luôn media đang xem vào đó). Radix Dialog lo phần khó: khoá focus trong hộp thoại, Esc để
// đóng, trả focus về nút đã mở.
export function PlaylistDialog({
  slug,
  title,
  onClose,
}: {
  slug: string;
  title: string;
  onClose: () => void;
}) {
  const invalidate = useInvalidateLibrary();
  const { data: playlists, isPending } = usePlaylists();
  const { data: state } = useMediaState(slug);
  const inList = new Set(state?.playlist_ids ?? []);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const toggle = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      api<void>(`/me/playlists/${id}/items/${slug}`, { method: add ? "PUT" : "DELETE" }),
    onSettled: () => invalidate(slug),
  });

  const create = useMutation({
    mutationFn: async (n: string) => {
      const p = await api<Playlist>("/me/playlists", {
        method: "POST",
        body: JSON.stringify({ name: n }),
      });
      await api<void>(`/me/playlists/${p.id}/items/${slug}`, { method: "PUT" });
    },
    onSuccess: () => {
      setName("");
      setError("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Không tạo được playlist"),
    onSettled: () => invalidate(slug),
  });

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-overlay/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface p-5 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold">Lưu vào playlist</Dialog.Title>
              <Dialog.Description className="truncate text-sm text-ink-muted">
                {title}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Đóng"
              className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-2"
            >
              <Icon name="close" className="size-5" />
            </Dialog.Close>
          </div>

          <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto">
            {isPending && <li className="h-10 animate-pulse rounded-card-sm bg-surface-2" />}
            {playlists?.length === 0 && (
              <li className="py-2 text-sm text-ink-muted">Bạn chưa có playlist nào.</li>
            )}
            {playlists?.map((p) => (
              <li key={p.id}>
                <label className="flex h-11 cursor-pointer items-center gap-3 rounded-card-sm px-2 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={inList.has(p.id)}
                    disabled={!state || toggle.isPending}
                    onChange={(e) => toggle.mutate({ id: p.id, add: e.target.checked })}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-sm text-ink-muted">{p.item_count}</span>
                </label>
              </li>
            ))}
          </ul>

          <form
            className="mt-4 flex gap-2 border-t border-ink/[0.07] pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Tên playlist mới"
              aria-label="Tên playlist mới"
              className="h-10 min-w-0 flex-1 rounded-card-sm bg-surface px-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
            >
              Tạo
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- **Trạng thái tích lấy từ `playlist_ids`** của `GET /me/media/{slug}` (bài 6.01), không tự giữ bằng
  `useState`: đóng mở lại hộp thoại, hay thêm từ tab khác, vẫn đúng.
- **Tạo xong thêm luôn** media đang xem vào playlist mới: người dùng mở hộp thoại là để lưu video này.
- **`z-[100]`**: cao hơn trình phát (`z-[80]`, bài 2.12), nếu không iframe YouTube đè lên hộp thoại.

### Bước 4: Gắn vào trang xem, `frontend/src/components/watch/WatchPage.tsx`

`MediaActions` nằm cùng hàng với nút Theo dõi; `ResumeNote` dưới trình phát. Bản đầy đủ:

```tsx
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { FollowButton } from "@/components/channel/FollowButton";
import { CommentSection } from "@/components/comment/CommentSection";
import { MediaActions } from "@/components/library/MediaActions";
import { ResumeNote } from "@/components/library/ResumeNote";
import { mediaHref, viewWord } from "@/components/media/links";
import { PlayerSlot } from "@/components/player/PlayerSlot";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { getMedia } from "./get-media";

// Trang xem / nghe một media: trình phát, thông tin, kênh, mô tả, gợi ý bên phải.
export async function WatchPage({ category, slug }: { category: "xem" | "nghe"; slug: string }) {
  const media = await getMedia(slug);
  // /nghe/<slug-của-phim> → chuyển về đúng /xem/<slug> (308), để mỗi nội dung chỉ có một URL
  if (media.category !== category) permanentRedirect(mediaHref(media));

  const related = await api<MediaCard[]>(`/media/${encodeURIComponent(slug)}/related`);

  return (
    <div className="mx-auto grid max-w-[1680px] gap-6 px-3 py-4 md:px-6 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {media.youtube_id ? (
          <PlayerSlot
            media={{
              slug: media.slug,
              category: media.category,
              title: media.title,
              channel: media.channel.name,
              thumbnail: media.thumbnail_url,
              youtubeId: media.youtube_id,
            }}
          />
        ) : (
          <NoVideo thumbnail={media.thumbnail_url} />
        )}
        {media.youtube_id && <ResumeNote slug={media.slug} />}

        <h1 className="mt-4 text-xl font-bold md:text-2xl">{media.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
          <time dateTime={media.published_at}>{timeAgo(media.published_at)}</time> ·{" "}
          {media.group_label} · {media.genre_label}
          {durationLabel(media) && ` · ${durationLabel(media)}`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/kenh/${media.channel.slug}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <Avatar name={media.channel.name} />
            <span className="flex items-center gap-1 font-semibold hover:text-brand-700">
              {media.channel.name}
              {media.channel.verified && <Icon name="check" className="size-4 text-brand-600" />}
            </span>
          </Link>
          <FollowButton
            slug={media.channel.slug}
            initial={{ following: false, followers_count: media.channel.followers_count ?? 0 }}
          />
          <MediaActions slug={media.slug} title={media.title} />
        </div>

        <div className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-4 text-[15px] leading-relaxed">
          {media.lineup_month && (
            <p className="mb-2 text-sm font-semibold text-accent-700">
              Line-up phim tháng {media.lineup_month.split("-").reverse().join("/")}
            </p>
          )}
          {media.description || "Chưa có mô tả."}
        </div>

        <CommentSection target={{ kind: "media", slug: media.slug }} />
      </div>

      <aside aria-label="Có thể bạn thích">
        <h2 className="mb-3 font-bold">Có thể bạn thích</h2>
        <ul className="grid gap-3">
          {related.map((m) => (
            <li key={m.id}>
              <RelatedItem media={m} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function NoVideo({ thumbnail }: { thumbnail: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-overlay">
      <Image
        src={thumbnail}
        alt=""
        fill
        sizes="(min-width: 1024px) 60vw, 100vw"
        className="object-cover opacity-40"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white">
        <Icon name="screen" className="size-12 text-white/70" />
        <p className="mt-3 font-semibold">Nội dung này chưa có video</p>
        <p className="text-sm text-white/70">Video sẽ được cập nhật sớm.</p>
      </div>
    </div>
  );
}

function RelatedItem({ media }: { media: MediaCard }) {
  return (
    <Link href={mediaHref(media)} className="group flex gap-3">
      <span className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
        <Image src={media.thumbnail_url} alt="" fill sizes="160px" className="object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
          {durationLabel(media)}
        </span>
      </span>
      <span className="grid min-w-0 content-start">
        <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
          {media.title}
        </strong>
        <small className="mt-1 truncate text-ink-muted">{media.channel.name}</small>
        <small className="text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)}
        </small>
      </span>
    </Link>
  );
}
```

### Bước 5: Vạch tiến độ trên thẻ, `frontend/src/components/media/MediaCard.tsx`

Thẻ nhận thêm `progress` (vạch đỏ ở đáy ảnh) và `action` (nút ở bên phải tiêu đề). Bản đầy đủ:

```tsx
import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard as Media, Progress } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Thẻ media trong lưới (trang chủ, chuyên mục). Ảnh 16:9, nhãn thời lượng góc dưới phải,
// avatar kênh + tiêu đề + "1,1 Tr lượt xem · 2 tuần trước" như mockup.
// progress (lịch sử xem): vạch đỏ ở đáy ảnh cho biết đã xem tới đâu. action: nút thêm ở góc
// phải (vd. "Bỏ khỏi lịch sử"), do nơi dùng truyền vào.
export function MediaCard({
  media,
  priority = false,
  progress,
  action,
}: {
  media: Media;
  priority?: boolean;
  progress?: Progress;
  action?: React.ReactNode;
}) {
  const href = mediaHref(media);
  const duration = durationLabel(media);
  return (
    <article className="group">
      <Link href={href} className="block" tabIndex={-1} aria-hidden="true">
        <div className="relative aspect-video overflow-hidden rounded-card bg-surface-3">
          <Image
            src={media.thumbnail_url}
            alt=""
            fill
            priority={priority}
            // Trình duyệt chọn cỡ ảnh vừa đủ theo bề rộng thẻ trên từng màn hình
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
          />
          {duration && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
              {duration}
            </span>
          )}
          {progress && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/40">
              <span
                className="block h-full bg-danger"
                style={{
                  width: `${Math.min(100, (progress.position / progress.duration) * 100)}%`,
                }}
              />
            </span>
          )}
        </div>
      </Link>
      <div className="mt-3 flex gap-3">
        <Avatar name={media.channel.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link href={href} className="hover:text-brand-700">
              {media.title}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
            <Link href={`/kenh/${media.channel.slug}`} className="hover:text-ink">
              {media.channel.name}
            </Link>
            {media.channel.verified && (
              <span title="Kênh đã xác minh">
                <Icon name="check" className="size-3.5 text-brand-600" />
                <span className="sr-only">(đã xác minh)</span>
              </span>
            )}
          </p>
          <p className="text-sm text-ink-muted">
            {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
            {/* Server và trình duyệt tính "x phút trước" ở hai thời điểm khác nhau một chút */}
            <time dateTime={media.published_at} suppressHydrationWarning>
              {timeAgo(media.published_at)}
            </time>
          </p>
        </div>
        {action}
      </div>
    </article>
  );
}
```

`min-w-0 flex-1` cho khối chữ để nút `action` luôn nằm sát mép phải.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Khách mở trang xem | "Lưu", "Playlist" là link tới `/dang-nhap?next=...` |
| Đăng nhập, bấm "Lưu" | Đổi ngay thành "Đã lưu", icon tô đặc (`aria-pressed="true"`) |
| Bấm "Playlist", gõ "Bay đêm dài", bấm "Tạo" | Playlist mới xuất hiện, đã được tích, số mục là 1 |
| Bỏ tích | Số mục về 0 |
| Bấm Esc | Hộp thoại đóng, focus trở về nút "Playlist" |
| Màn 390px | Hàng nút xuống dòng gọn: kênh + Theo dõi, rồi Lưu + Playlist |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Trình phát YouTube đè lên hộp thoại | Lớp phủ và hộp thoại phải có `z-index` cao hơn `YouTubeHost` |
| Console: `Missing Description or aria-describedby` | Radix cần `Dialog.Description`, hoặc `aria-describedby={undefined}` nếu không có mô tả |
| Bấm Lưu liên tục thì nút nhấp nháy sai trạng thái | Thiếu `cancelQueries` trong `onMutate`: lần tải cũ về sau ghi đè trạng thái vừa bấm |
