import type { MediaCard } from "@/lib/types";

// Đường dẫn trang xem: /xem/<slug> hoặc /nghe/<slug>
export function mediaHref(m: Pick<MediaCard, "category" | "slug">): string {
  return `/${m.category}/${m.slug}`;
}

// "lượt xem" cho video, "lượt nghe" cho âm thanh
export function viewWord(m: Pick<MediaCard, "kind">): string {
  return m.kind === "audio" ? "lượt nghe" : "lượt xem";
}
