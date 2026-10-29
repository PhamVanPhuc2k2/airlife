import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { durationLabel } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { mediaHref } from "./links";

// Ô ảnh có chữ đè lên (3 ô bên trái khối nổi bật ở trang chủ).
export function MediaTile({ media }: { media: MediaCard }) {
  return (
    <Link
      href={mediaHref(media)}
      className="group relative block aspect-video overflow-hidden rounded-card bg-overlay lg:aspect-auto lg:h-full"
    >
      <Image
        src={media.thumbnail_url}
        alt=""
        fill
        sizes="(min-width: 1024px) 22vw, 70vw"
        className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
      />
      <span className="absolute inset-0 bg-gradient-hero" />
      <span className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
        <Icon name="play" className="size-3.5" />
      </span>
      <span className="absolute inset-x-3 bottom-3 grid text-white">
        <small className="truncate text-xs text-brand-200">
          {media.group_label} · {durationLabel(media)}
        </small>
        <strong className="truncate text-[15px]">{media.title}</strong>
      </span>
    </Link>
  );
}
