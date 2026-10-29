"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { api } from "@/lib/api";
import type { LibraryStats as Stats } from "@/lib/types";

// Bốn con số dưới thẻ hồ sơ (mockup: profile__stats). Bấm vào là tới đúng tab Sưu tập.
export function LibraryStats() {
  const { data } = useQuery({
    queryKey: ["me", "stats"],
    queryFn: () => api<Stats>("/me/stats"),
  });
  const items = [
    { label: "Đang theo dõi", value: data?.following, href: "#kenh-theo-doi" },
    { label: "Đã lưu", value: data?.saved, href: "/suu-tap?tab=da-luu" },
    { label: "Playlist", value: data?.playlists, href: "/suu-tap" },
    { label: "Đơn hàng", value: data?.orders, href: "/don-hang" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <li key={it.label}>
          <Link
            href={it.href}
            className="block rounded-card bg-surface p-4 text-center shadow-sm ring-1 ring-ink/[0.07] transition hover:ring-brand-300"
          >
            <b className="block text-2xl font-bold">{it.value ?? "–"}</b>
            <small className="text-sm text-ink-muted">{it.label}</small>
          </Link>
        </li>
      ))}
    </ul>
  );
}
