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
