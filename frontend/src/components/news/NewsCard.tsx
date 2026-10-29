import Image from "next/image";
import Link from "next/link";

import { formatDate } from "@/lib/format";
import type { NewsCard as News } from "@/lib/types";

// Thẻ bài viết: ảnh bìa, nhãn chuyên mục, tiêu đề, tóm tắt, ngày đăng.
export function NewsCard({ news }: { news: News }) {
  const href = `/tin-tuc/${news.slug}`;
  return (
    <article className="group flex flex-col overflow-hidden rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-[16/9] bg-surface-3"
      >
        <Image
          src={news.cover_url}
          alt=""
          fill
          sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
        />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-brand-600">
          {news.category_name}
        </span>
        <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-snug">
          <Link href={href} className="hover:text-brand-700">
            {news.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-3 text-sm text-ink-muted">{news.excerpt}</p>
        <time dateTime={news.published_at} className="mt-auto pt-3 text-xs text-ink-dim">
          {formatDate(news.published_at)}
        </time>
      </div>
    </article>
  );
}
