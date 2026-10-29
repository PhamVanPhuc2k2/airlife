import Image from "next/image";
import Link from "next/link";

import { mediaHref } from "@/components/media/links";
import type { MediaCard } from "@/lib/types";

// Poster phim đứng 2:3 (tab Line-up phim tháng của trang Mới tải, mockup: .poster).
// Dữ liệu chỉ có ảnh ngang 16:9, nên cắt giữa (object-cover). Khi có ảnh poster thật thì
// thêm cột poster_url cho media.
export function PosterCard({ media, isNew }: { media: MediaCard; isNew: boolean }) {
  return (
    <Link href={mediaHref(media)} className="group grid gap-2">
      <span className="relative aspect-[2/3] overflow-hidden rounded-card bg-surface-3 shadow-sm">
        <Image
          src={media.thumbnail_url}
          alt=""
          fill
          sizes="(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 45vw"
          className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
        />
        {isNew && (
          <span className="absolute left-2 top-2 rounded-full bg-gradient-accent px-2 py-0.5 text-xs font-bold text-white">
            Mới
          </span>
        )}
      </span>
      <strong className="line-clamp-2 leading-snug group-hover:text-brand-700">
        {media.title}
      </strong>
      <small className="text-ink-muted">
        {media.group_label} · {media.genre_label}
      </small>
    </Link>
  );
}
