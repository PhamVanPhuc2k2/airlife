import Image from "next/image";
import Link from "next/link";

import type { NewsCard } from "@/lib/types";

// Bài nổi bật đầu trang Tin tức (mockup: .news-lead): ảnh lớn, chữ đè lên.
export function NewsLead({ news }: { news: NewsCard }) {
  return (
    <Link
      href={`/tin-tuc/${news.slug}`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-card bg-overlay sm:aspect-[21/9]"
    >
      <Image
        src={news.cover_url}
        alt=""
        fill
        loading="eager"
        fetchPriority="high"
        sizes="(min-width: 1280px) 80vw, 100vw"
        className="object-cover transition-transform duration-700 ease-brand group-hover:scale-[1.03]"
      />
      <span className="absolute inset-0 bg-gradient-hero" />
      <span className="absolute inset-x-5 bottom-5 grid max-w-3xl gap-2 text-white md:inset-x-8 md:bottom-8">
        <span className="w-fit rounded-full bg-gradient-accent px-2.5 py-1 text-xs font-bold">
          {news.category_name}
        </span>
        <strong className="text-2xl font-bold leading-tight md:text-4xl">{news.title}</strong>
        <small className="line-clamp-2 text-sm text-white/80 md:text-base">{news.excerpt}</small>
      </span>
    </Link>
  );
}
