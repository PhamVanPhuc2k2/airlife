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
