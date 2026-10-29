import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import type { MediaCard } from "@/lib/types";

import { mediaHref } from "./links";

// Khối nổi bật giữa trang chủ: ảnh lớn, lớp phủ tối dần xuống dưới, chữ trắng.
export function FeaturedHero({ media }: { media: MediaCard }) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-overlay sm:aspect-video lg:aspect-auto lg:h-full lg:min-h-[340px]">
      <Image
        src={media.thumbnail_url}
        alt=""
        fill
        priority // ảnh lớn nhất màn hình đầu: tải sớm (tốt cho chỉ số LCP)
        sizes="(min-width: 1024px) 55vw, 100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-x-5 bottom-5 text-white md:inset-x-8 md:bottom-7">
        <span className="rounded-full bg-gradient-accent px-2.5 py-1 text-xs font-bold">
          Nổi bật
        </span>
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-200">
          {media.group_label} · {media.genre_label}
        </p>
        <h1 className="mt-1 text-3xl font-bold leading-tight md:text-[40px]">{media.title}</h1>
        {media.description && (
          <p className="mt-2 line-clamp-2 hidden max-w-2xl text-white/80 xl:block">
            {media.description}
          </p>
        )}
        <div className="mt-4 flex gap-3">
          <Link
            href={mediaHref(media)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-brand px-5 font-semibold shadow-brand transition hover:brightness-110"
          >
            <Icon name="play" className="size-4" />
            Xem ngay
          </Link>
          <Link
            href="/dang-nhap"
            title="Đăng nhập để lưu"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-semibold ring-1 ring-white/25 backdrop-blur transition hover:bg-white/20"
          >
            <Icon name="library" className="size-[18px]" />
            Lưu
          </Link>
        </div>
      </div>
    </div>
  );
}
