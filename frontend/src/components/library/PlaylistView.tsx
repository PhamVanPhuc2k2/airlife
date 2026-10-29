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
