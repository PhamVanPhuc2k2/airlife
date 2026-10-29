# Bài 6.06: Trang Sưu tập và trang playlist; nghiệm thu Phần 06

> [← Bài trước](05-trang-ban.md) · [Mục lục](../README.md)

## Mục tiêu

- `/suu-tap` (mockup `renderCollection`) có ba tab: Playlist, Đã lưu, Đã xem. Tab "Yêu thích" (sản phẩm,
  tour) thêm ở Phần 07.
- `/suu-tap/playlist/[id]`: đổi tên, xoá, phát từ đầu, bỏ từng mục.

## Bạn sẽ học

- Tab bằng link `?tab=` đọc từ `searchParams` của trang server.
- Một component lưới dùng cho hai danh sách khác nhau (đã lưu, đã xem).
- Trang chi tiết của dữ liệu riêng tư: không dùng `notFound()` của server mà tự xử lý 404 ở client.

## Viết code

### Bước 1: Nút xoá nhỏ, `frontend/src/components/library/RemoveButton.tsx`

```tsx
"use client";

import { Icon } from "@/components/icons/Icon";

// Nút xoá nhỏ ở góc thẻ media (bỏ khỏi lịch sử, bỏ lưu, bỏ khỏi playlist)
export function RemoveButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
    >
      <Icon name="trash" className="size-4" />
    </button>
  );
}
```

### Bước 2: Lưới Đã lưu / Đã xem, `frontend/src/components/library/LibraryGrid.tsx`

Thêm `libraryListOptions` vào cuối `frontend/src/lib/queries.ts`:

```ts
// Lịch sử xem / đã lưu của người đang đăng nhập. Key bắt đầu bằng "me": đăng xuất thì
// useLogout xoá sạch cache, không để lộ cho người dùng sau trên cùng máy.
export function libraryListOptions(list: "history" | "saved") {
  return infiniteQueryOptions({
    queryKey: ["me", list],
    queryFn: ({ pageParam, signal }) =>
      api<LibraryPage>(`/me/${list}?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

(nhớ thêm `LibraryPage` vào dòng `import type` đầu file)

```tsx
"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";

import { MediaCard } from "@/components/media/MediaCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { api } from "@/lib/api";
import { useInvalidateLibrary } from "@/lib/library";
import { libraryListOptions } from "@/lib/queries";

import { RemoveButton } from "./RemoveButton";

const TEXT = {
  history: {
    empty: "Bạn chưa xem nội dung nào. Nội dung bạn xem sẽ hiện ở đây.",
    remove: "Xoá khỏi lịch sử",
  },
  saved: {
    empty: "Chưa có nội dung đã lưu. Bấm “Lưu” ở trang xem để lưu lại xem sau.",
    remove: "Bỏ lưu",
  },
};

// Lưới "Đã xem" (list = history, có vạch tiến độ) hoặc "Đã lưu" (list = saved) ở Sưu tập.
export function LibraryGrid({ list }: { list: "history" | "saved" }) {
  const invalidate = useInvalidateLibrary();
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    libraryListOptions(list),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const remove = useMutation({
    mutationFn: (slug: string) => api<void>(`/me/${list}/${slug}`, { method: "DELETE" }),
    onSettled: (_d, _e, slug) => invalidate(slug),
  });
  const clear = useMutation({
    mutationFn: () => api<void>("/me/history", { method: "DELETE" }),
    onSettled: () => invalidate(),
  });

  if (isPending) {
    return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  }
  if (items.length === 0) {
    return <p className="py-16 text-center text-ink-muted">{TEXT[list].empty}</p>;
  }

  return (
    <>
      {list === "history" && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Xoá toàn bộ lịch sử xem?")) clear.mutate();
            }}
            disabled={clear.isPending}
            className="text-sm font-semibold text-ink-muted hover:text-danger"
          >
            Xoá toàn bộ lịch sử
          </button>
        </div>
      )}
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m) => (
          <MediaCard
            key={m.id}
            media={m}
            progress={m.progress}
            action={
              <RemoveButton
                label={TEXT[list].remove}
                disabled={remove.isPending}
                onClick={() => remove.mutate(m.slug)}
              />
            }
          />
        ))}
      </div>
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </>
  );
}
```

Đường dẫn API của hai danh sách đặt cùng khuôn (`/me/history/{slug}`, `/me/saved/{slug}`) nên một dòng
`api(`/me/${list}/${slug}`)` dùng được cho cả hai.

### Bước 3: Lưới playlist, `frontend/src/components/library/PlaylistGrid.tsx`

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { ApiError, api } from "@/lib/api";
import { useInvalidateLibrary, usePlaylists } from "@/lib/library";
import type { Playlist } from "@/lib/types";

// Tab Playlist ở Sưu tập (mockup: playlist-grid): ảnh mục đầu, số mục, tên; ô cuối "Tạo playlist mới".
export function PlaylistGrid() {
  const { data, isPending } = usePlaylists();
  const [creating, setCreating] = useState(false);

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;

  return (
    <>
      <ul className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {data?.map((p) => (
          <li key={p.id}>
            <PlaylistCard playlist={p} />
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink/[0.14] font-semibold text-ink-muted transition hover:border-brand-300 hover:text-brand-700"
          >
            <Icon name="plus" className="size-6" />
            Tạo playlist mới
          </button>
        </li>
      </ul>
      {creating && <CreatePlaylistDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function PlaylistCard({ playlist: p }: { playlist: Playlist }) {
  const href = `/suu-tap/playlist/${p.id}`;
  return (
    <Link href={href} className="group block">
      {/* Hai lớp giả phía sau ảnh: nhìn như một chồng video (mockup: playlist__stack) */}
      <div className="relative pt-2">
        <span className="absolute inset-x-4 top-0 h-4 rounded-t-card bg-brand-200" aria-hidden />
        <div className="relative aspect-video overflow-hidden rounded-card bg-gradient-brand">
          {p.first && (
            <Image
              src={p.first.thumbnail_url}
              alt=""
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
            />
          )}
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
            <Icon name="library" className="size-3.5" />
            {p.item_count} mục
          </span>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 font-semibold group-hover:text-brand-700">{p.name}</p>
      <p className="text-sm text-ink-muted">Xem playlist</p>
    </Link>
  );
}

function CreatePlaylistDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateLibrary();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (n: string) =>
      api<Playlist>("/me/playlists", { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const error =
    create.error instanceof ApiError
      ? create.error.message
      : create.error && "Không tạo được playlist";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-overlay/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface p-5 shadow-lg"
        >
          <Dialog.Title className="text-lg font-bold">Tạo playlist mới</Dialog.Title>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="VD: Xem trên chuyến bay dài"
              aria-label="Tên playlist"
              className="h-11 rounded-card-sm bg-surface px-4 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close className="h-10 rounded-full px-4 font-semibold text-ink-2 hover:bg-surface-2">
                Huỷ
              </Dialog.Close>
              <button
                type="submit"
                disabled={!name.trim() || create.isPending}
                className="h-10 rounded-full bg-ink px-5 font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
              >
                Tạo
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Playlist rỗng không có ảnh: ô ảnh dùng nền `bg-gradient-brand`.

### Bước 4: Trang Sưu tập, `frontend/src/app/suu-tap/page.tsx`

```tsx
import type { Metadata } from "next";

import { LibraryGrid } from "@/components/library/LibraryGrid";
import { PlaylistGrid } from "@/components/library/PlaylistGrid";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";

export const metadata: Metadata = { title: "Sưu tập", robots: { index: false } };

// Tab "Yêu thích" (sản phẩm, tour) của mockup thêm ở Phần 07 khi có sản phẩm.
const TABS = [
  { key: "playlist", label: "Playlist" },
  { key: "da-luu", label: "Đã lưu" },
  { key: "da-xem", label: "Đã xem" },
] as const;

type Props = { searchParams: Promise<{ tab?: string }> };

// Sưu tập (mockup: renderCollection). Mỗi tab là một link ?tab=… (dán link là mở đúng tab).
// Trang chỉ dựng khung; danh sách là dữ liệu riêng nên client component lấy ở trình duyệt.
export default async function Page({ searchParams }: Props) {
  const { tab: raw } = await searchParams;
  const tab = TABS.find((t) => t.key === raw)?.key ?? "playlist";

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="library"
        title="Sưu tập"
        desc="Playlist của bạn, nội dung đã lưu để xem sau và lịch sử xem."
      />
      <TabLinks
        label="Sưu tập"
        items={TABS.map((t) => ({
          label: t.label,
          href: t.key === "playlist" ? "/suu-tap" : `/suu-tap?tab=${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "playlist" && <PlaylistGrid />}
      {tab === "da-luu" && <LibraryGrid list="saved" />}
      {tab === "da-xem" && <LibraryGrid list="history" />}
    </div>
  );
}
```

`?tab=` lạ (gõ tay) thì về tab Playlist, không báo lỗi. `proxy.ts` (bài 4.08) đã chặn khách cho
`/suu-tap/:path*` nên không phải sửa.

### Bước 5: Trang playlist

`frontend/src/components/library/PlaylistView.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { MediaCard } from "@/components/media/MediaCard";
import { mediaHref } from "@/components/media/links";
import { ApiError, api } from "@/lib/api";
import { playlistKey, useInvalidateLibrary } from "@/lib/library";
import type { PlaylistDetail } from "@/lib/types";

import { RemoveButton } from "./RemoveButton";

// Trang một playlist: đổi tên, xoá playlist, phát tất cả, bỏ từng mục.
export function PlaylistView({ id }: { id: string }) {
  const router = useRouter();
  const invalidate = useInvalidateLibrary();
  const { data, isPending, error } = useQuery({
    queryKey: playlistKey(id),
    queryFn: () => api<PlaylistDetail>(`/me/playlists/${id}`),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  const [editing, setEditing] = useState(false);

  const rename = useMutation({
    mutationFn: (name: string) =>
      api<void>(`/me/playlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => setEditing(false),
    onSettled: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/me/playlists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      router.replace("/suu-tap");
    },
  });
  const removeItem = useMutation({
    mutationFn: (slug: string) =>
      api<void>(`/me/playlists/${id}/items/${slug}`, { method: "DELETE" }),
    onSettled: (_d, _e, slug) => invalidate(slug),
  });

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="py-16 text-center">
        <p className="text-ink-muted">
          {notFound ? "Không tìm thấy playlist này." : "Không tải được playlist."}
        </p>
        <Link href="/suu-tap" className="mt-3 inline-block font-semibold text-brand-700">
          Về Sưu tập
        </Link>
      </div>
    );
  }

  const first = data.items[0];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        {editing ? (
          <RenameForm
            initial={data.name}
            pending={rename.isPending}
            error={rename.error instanceof ApiError ? rename.error.message : undefined}
            onSubmit={(name) => rename.mutate(name)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold md:text-3xl">{data.name}</h1>
              <p className="text-ink-muted">{data.item_count} mục · chỉ mình bạn xem được</p>
            </div>
            {first && (
              <Link
                href={mediaHref(first)}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-white hover:bg-ink-2"
              >
                <Icon name="play" className="size-4" />
                Phát từ đầu
              </Link>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 font-semibold text-ink-2 hover:bg-surface-3"
            >
              <Icon name="pencil" className="size-4" />
              Đổi tên
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Xoá playlist “${data.name}”?`)) remove.mutate();
              }}
              disabled={remove.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 font-semibold text-ink-2 hover:bg-surface-3 hover:text-danger"
            >
              <Icon name="trash" className="size-4" />
              Xoá
            </button>
          </>
        )}
      </header>

      {data.items.length === 0 ? (
        <p className="py-16 text-center text-ink-muted">
          Playlist trống. Bấm “Playlist” ở trang xem để thêm nội dung.
        </p>
      ) : (
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.items.map((m) => (
            <MediaCard
              key={m.id}
              media={m}
              action={
                <RemoveButton
                  label="Bỏ khỏi playlist"
                  disabled={removeItem.isPending}
                  onClick={() => removeItem.mutate(m.slug)}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RenameForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: string;
  pending: boolean;
  error?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  // Esc để huỷ đổi tên
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        aria-label="Tên playlist"
        className="h-11 min-w-0 flex-1 rounded-card-sm bg-surface px-4 text-lg font-bold ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
      />
      <button
        type="submit"
        disabled={!name.trim() || pending}
        className="h-10 rounded-full bg-ink px-5 font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
      >
        Lưu
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="h-10 rounded-full px-4 font-semibold text-ink-2 hover:bg-surface-2"
      >
        Huỷ
      </button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
```

- **`retry` bỏ qua `404`**: playlist không có (đã xoá, hay id của người khác) thì báo ngay, không thử lại 3
  lần như lỗi mạng.
- **Xoá xong `router.replace`** (không phải `push`): bấm Back không quay lại trang của playlist đã xoá.
- **"Phát từ đầu"** mở mục đầu tiên. Tự chuyển sang mục tiếp theo khi hết bài chưa làm (cần hàng đợi phát
  trong store, ghi ở TASKS.md).

`frontend/src/app/suu-tap/playlist/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { PlaylistView } from "@/components/library/PlaylistView";

export const metadata: Metadata = { title: "Playlist", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

// Playlist là riêng tư: server không có cookie của khách nên không lấy được; PlaylistView lấy ở
// trình duyệt. proxy.ts đã chặn khách chưa đăng nhập (matcher /suu-tap/:path*).
export default async function Page({ params }: Props) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1680px] space-y-4 px-3 py-6 md:px-6">
      <Link
        href="/suu-tap"
        className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <Icon name="chevron" className="size-4 rotate-180" />
        Sưu tập
      </Link>
      <PlaylistView id={id} />
    </div>
  );
}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
```

Nghiệm thu Phần 06 trên trình duyệt (http://localhost:3000), một tài khoản mới:

| Làm gì | Thấy gì |
|---|---|
| Khách mở `/suu-tap` | Chuyển sang `/dang-nhap?next=%2Fsuu-tap` |
| Trang xem: Lưu, tạo playlist "Bay đêm dài", xem một lúc rồi dừng | Như bài 6.03, 6.04 |
| `/suu-tap` | Thẻ "Bay đêm dài", "1 mục", ảnh của phim; ô "Tạo playlist mới" |
| Tab Đã lưu | Phim vừa lưu; bấm thùng rác thì biến mất |
| Tab Đã xem | Phim vừa xem có vạch đỏ; "Xoá toàn bộ lịch sử" hỏi lại rồi xoá hết |
| Mở playlist, "Đổi tên" thành "Xem trên chuyến bay dài", Lưu | Tiêu đề đổi; tab Playlist cũng đổi |
| Bấm thùng rác ở một mục | "0 mục", "Playlist trống…" |
| Mở `/suu-tap/playlist/00000000-0000-0000-0000-000000000000` | "Không tìm thấy playlist này." và link về Sưu tập |
| Xoá playlist | Về `/suu-tap`, playlist không còn |

Dọn tài khoản thử trong `make psql` như bài 6.02, rồi:

```bash
git add . && git commit -m "Bạn và Sưu tập: lịch sử xem, đã lưu, playlist"
```

Đến đây xong Phần 06.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đổi tab thì cả trang tải lại | Bình thường: tab là link tới URL khác. Dữ liệu đã tải nằm trong cache TanStack Query nên vẫn hiện ngay |
| Trang playlist hiện "Không tải được" lâu rồi mới báo | Chưa bỏ `retry` cho lỗi 404 |
| Xoá playlist xong bấm Back thì gặp trang "Không tìm thấy" | Dùng `router.push`; đổi thành `router.replace` |
