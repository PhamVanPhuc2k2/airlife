import Image from "next/image";
import Link from "next/link";

import { CommentSection } from "@/components/comment/CommentSection";
import { Icon } from "@/components/icons/Icon";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { NewsCard } from "@/lib/types";

import { getArticle } from "./get-article";

export async function ArticlePage({ slug }: { slug: string }) {
  const [article, related] = await Promise.all([
    getArticle(slug),
    api<NewsCard[]>(`/news/${encodeURIComponent(slug)}/related`),
  ]);

  return (
    <div className="mx-auto grid max-w-[1280px] gap-10 px-3 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <article className="min-w-0">
        <nav aria-label="Đường dẫn" className="flex items-center gap-1 text-sm text-ink-muted">
          <Link href="/tin-tuc" className="hover:text-brand-700">
            Tin tức
          </Link>
          <Icon name="chevron" className="size-3.5" />
          <Link href={`/tin-tuc?f=${article.category}`} className="hover:text-brand-700">
            {article.category_name}
          </Link>
        </nav>

        <h1 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">{article.title}</h1>
        <p className="mt-3 text-sm text-ink-muted">
          <time dateTime={article.published_at}>{formatDate(article.published_at)}</time> ·{" "}
          {article.author}
        </p>
        <p className="mt-4 text-lg font-medium text-ink-2">{article.excerpt}</p>

        <div className="relative mt-6 aspect-[15/8] overflow-hidden rounded-card bg-surface-3">
          <Image
            src={article.cover_url}
            alt=""
            fill
            loading="eager"
            fetchPriority="high"
            sizes="(min-width: 1024px) 900px, 100vw"
            className="object-cover"
          />
        </div>

        {/* Thân bài là HTML do biên tập viên nhập. dangerouslySetInnerHTML chèn nguyên văn, nên
            AN TOÀN chỉ vì backend đã lọc bằng bluemonday trước khi lưu (backend/pkg/sanitize).
            Không bao giờ dùng cách này với HTML chưa lọc. */}
        <div
          className="prose prose-lg mt-8 max-w-none prose-headings:font-bold prose-a:text-brand-700 prose-blockquote:border-brand-500 prose-blockquote:font-medium prose-blockquote:text-ink-2"
          dangerouslySetInnerHTML={{ __html: article.body_html }}
        />

        <CommentSection target={{ kind: "news", slug: article.slug }} />
      </article>

      <aside
        aria-label="Đọc thêm"
        className="lg:sticky lg:top-[calc(theme(spacing.header)_+_theme(spacing.topnav)_+_24px)] lg:self-start"
      >
        <h2 className="mb-4 text-lg font-bold">Đọc thêm</h2>
        <ul className="grid gap-4">
          {related.map((n) => (
            <li key={n.id}>
              <Link href={`/tin-tuc/${n.slug}`} className="group flex gap-3">
                <span className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                  <Image src={n.cover_url} alt="" fill sizes="128px" className="object-cover" />
                </span>
                <span className="grid content-start">
                  <strong className="line-clamp-3 text-sm leading-snug group-hover:text-brand-700">
                    {n.title}
                  </strong>
                  <small className="mt-1 text-ink-muted">{formatDate(n.published_at)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
