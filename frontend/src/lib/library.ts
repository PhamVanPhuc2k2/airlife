"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useMe } from "./auth";
import type { MediaState, Playlist } from "./types";

// Thư viện cá nhân ở trình duyệt: trạng thái một media (đã lưu, xem tới đâu, trong playlist
// nào) và danh sách playlist. Chỉ gọi API khi đã đăng nhập.

export const mediaStateKey = (slug: string) => ["me", "media", slug] as const;
export const playlistsKey = ["me", "playlists"] as const;
export const playlistKey = (id: string) => ["me", "playlist", id] as const;

export function useMediaState(slug: string) {
  const { me } = useMe();
  return useQuery({
    queryKey: mediaStateKey(slug),
    queryFn: () => api<MediaState>(`/me/media/${slug}`),
    enabled: !!me,
  });
}

export function usePlaylists(enabled = true) {
  const { me } = useMe();
  return useQuery({
    queryKey: playlistsKey,
    queryFn: () => api<Playlist[]>("/me/playlists"),
    enabled: !!me && enabled,
  });
}

// Sau khi lưu / thêm vào playlist / xem: làm mới mọi danh sách của thư viện. Key "me" chung
// tiền tố, nhưng KHÔNG làm mới ["me","following"] hay thông tin tài khoản thì không cần;
// liệt kê rõ từng key cho dễ đọc.
export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return (slug?: string) => {
    for (const key of [
      ["me", "stats"],
      ["me", "saved"],
      ["me", "history"],
      ["me", "continue"],
      ["me", "playlists"],
      ["me", "playlist"],
    ]) {
      void qc.invalidateQueries({ queryKey: key });
    }
    if (slug) void qc.invalidateQueries({ queryKey: mediaStateKey(slug) });
  };
}
