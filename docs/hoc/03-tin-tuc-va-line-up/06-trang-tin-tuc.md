# Bài 3.06: Trang Tin tức và trang bài viết

> [← Bài trước](05-component-dung-chung.md) · [Mục lục](../README.md) · [Bài sau →](07-trang-moi-tai-line-up.md)

## Mục tiêu

`/tin-tuc` (bài nổi bật, chip chuyên mục, lưới cuộn tải thêm) và `/tin-tuc/<slug>` (thân bài định dạng
đẹp, "Đọc thêm" bám theo khi cuộn).

## Bạn sẽ học

- Plugin `@tailwindcss/typography`: định dạng HTML mà mình không kiểm soát từng thẻ.
- `dangerouslySetInnerHTML` an toàn khi nào.
- Open Graph kiểu `article`.
- Vá lỗ hổng của gói phụ thuộc bằng `overrides` thay vì `npm audit fix --force`.

## Viết code

### Bước 1: Plugin typography

```bash
make npm c="install --save-exact --save-dev @tailwindcss/typography@0.5.20"
```

Thân bài là `<p>`, `<h2>`, `<blockquote>`… do biên tập viên nhập, không gắn class Tailwind được. Tailwind
còn **xoá hết kiểu mặc định** của trình duyệt (preflight): `<h2>` trông như chữ thường. Class `prose`
của plugin định dạng lại cả khối. Đăng ký trong `frontend/tailwind.config.ts`:

```ts
import typography from "@tailwindcss/typography";
// ...
  // typography: class `prose` định dạng sẵn HTML thân bài viết (đoạn văn, tiêu đề, trích dẫn…)
  // mà không phải gắn class cho từng thẻ do biên tập viên nhập.
  plugins: [typography],
```

### Bước 2: Vá lỗ hổng mà plugin kéo theo

Cài xong, `make fe-audit` báo:

```text
postcss-selector-parser  <6.1.5
Severity: moderate
PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion
fix available via `npm audit fix --force`
Will install @tailwindcss/typography@0.5.4, which is a breaking change
```

Plugin ghim cứng `postcss-selector-parser@6.0.10` trong `package.json` của nó. Lệnh `npm audit fix
--force` mà npm gợi ý lại **hạ** plugin xuống 0.5.4: đi lùi, không phải vá. Cách đúng là `overrides`:
ép mọi chỗ plugin cần gói đó dùng bản đã vá. Thêm vào `frontend/package.json`:

```json
  "overrides": {
    "@tailwindcss/typography": {
      "postcss-selector-parser": "6.1.5"
    }
  }
```

```bash
make npm c="install"
make fe-audit        # found 0 vulnerabilities
make restart s=frontend
```

Đọc kỹ lời khuyên của `npm audit fix --force` trước khi chạy: chữ "breaking change" nghĩa là nó sẽ
đổi phiên bản lớn, có thể làm hỏng code.

### Bước 3: Thẻ và danh sách

#### `frontend/src/components/news/NewsCard.tsx`

```tsx
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
```

#### `frontend/src/components/news/NewsLead.tsx`

```tsx
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
        priority
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
```

#### `frontend/src/components/news/NewsGrid.tsx`

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { LoadMore } from "@/components/ui/LoadMore";
import { newsListOptions } from "@/lib/queries";

import { NewsCard } from "./NewsCard";
import { NewsLead } from "./NewsLead";

// Danh sách bài viết cuộn tải thêm. withLead: bài mới nhất hiện thành khối lớn ở đầu
// (chỉ khi xem "Tất cả", như mockup).
export function NewsGrid({ category, withLead }: { category?: string; withLead: boolean }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    newsListOptions(category),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return <p className="py-16 text-center text-ink-muted">Chưa có bài viết.</p>;
  }

  const [lead, ...rest] = items;
  const grid = withLead ? rest : items;
  return (
    <div className="space-y-6">
      {withLead && lead && <NewsLead news={lead} />}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {grid.map((n) => (
          <NewsCard key={n.id} news={n} />
        ))}
      </div>
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </div>
  );
}
```

`const [lead, ...rest] = items`: tách phần tử đầu và phần còn lại. Chỉ ở "Tất cả" bài đầu mới thành
khối lớn; khi lọc chuyên mục thì mọi bài là thẻ bình thường.

### Bước 4: `frontend/src/app/tin-tuc/page.tsx`

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

import { NewsGrid } from "@/components/news/NewsGrid";
import { ChipLinks } from "@/components/ui/ChipLinks";
import { PageHead } from "@/components/ui/PageHead";
import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { newsListOptions } from "@/lib/queries";
import type { NewsCategory } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Tin tức",
  description: "Khám phá điểm đến, sự kiện, mẹo bay và line-up phim trên Airlife.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Cùng mẫu với trang chuyên mục (bài 2.11): server lấy sẵn trang đầu, client cuộn tải thêm.
export default async function NewsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const category = typeof sp.f === "string" ? sp.f : undefined;

  const queryClient = getQueryClient();
  const [categories] = await Promise.all([
    api<NewsCategory[]>("/news/categories"),
    queryClient.prefetchInfiniteQuery(newsListOptions(category)),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-5 md:px-6">
      <PageHead
        icon="news"
        title="Tin tức"
        desc="Khám phá điểm đến, sự kiện, mẹo bay và line-up phim trên Airlife."
      />
      <ChipLinks
        items={[
          { href: "/tin-tuc", label: "Tất cả", active: !category },
          ...categories.map((c) => ({
            href: `/tin-tuc?f=${c.slug}`,
            label: c.name,
            active: category === c.slug,
          })),
        ]}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <NewsGrid category={category} withLead={!category} />
      </HydrationBoundary>
    </div>
  );
}
```

Cùng mẫu với trang chuyên mục (bài 2.11). Chip là link `?f=kham-pha`, đúng như các link tiểu mục
"Tin tức" ở menu ngang (Phần 01) đã trỏ sẵn.

### Bước 5: Trang bài viết

#### `frontend/src/components/news/get-article.ts`

```ts
import { notFound } from "next/navigation";
import { cache } from "react";

import { ApiError, api } from "@/lib/api";
import type { Article } from "@/lib/types";

// Giống getMedia (bài 2.12): dùng chung cho generateMetadata và trang, gọi API một lần.
export const getArticle = cache(async (slug: string): Promise<Article> => {
  try {
    return await api<Article>(`/news/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});
```

#### `frontend/src/components/news/ArticlePage.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";

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
            priority
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
```

- **`dangerouslySetInnerHTML`**: React mặc định **escape** mọi chuỗi (`<` thành `&lt;`), nên chèn HTML
  phải dùng prop có tên cố tình đáng sợ này. An toàn ở đây vì một lý do duy nhất: backend đã lọc lúc
  ghi (bài 3.01, 3.03). Comment trong code ghi rõ lý do để người sau không bắt chước ở chỗ khác.
- **`prose-a:text-brand-700`, `prose-blockquote:border-brand-500`**: chỉnh màu của `prose` theo thương hiệu
  bằng biến thể `prose-<thẻ>:`.
- **Cột "Đọc thêm" `lg:sticky`**: bám ở trên khi cuộn bài dài. `top` = header + menu ngang + 24px để
  không bị che.

#### `frontend/src/app/tin-tuc/[slug]/page.tsx`

```tsx
import type { Metadata } from "next";

import { ArticlePage } from "@/components/news/ArticlePage";
import { getArticle } from "@/components/news/get-article";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await getArticle((await params).slug);
  return {
    title: a.title,
    description: a.excerpt,
    // type "article" + thời gian đăng: Facebook/Zalo hiện đúng kiểu thẻ bài viết
    openGraph: {
      type: "article",
      title: a.title,
      description: a.excerpt,
      images: [a.cover_url],
      publishedTime: a.published_at,
      modifiedTime: a.updated_at,
    },
  };
}

export default async function Page({ params }: Props) {
  return <ArticlePage slug={(await params).slug} />;
}
```

## Kiểm tra

- http://localhost:3000/tin-tuc: bài "Airlife đưa 40 phim mới…" là khối lớn, bên dưới 7 thẻ. Menu ngang
  sáng "Tin tức".
- Bấm "Khám phá": `/tin-tuc?f=kham-pha`, 3 bài, không còn khối lớn.
- Mở một bài: đường dẫn "Tin tức › Mẹo bay", thân bài có tiêu đề "Điểm nổi bật" và trích dẫn có vạch
  tím. Cuộn xuống: cột "Đọc thêm" bám theo.

```bash
curl -s localhost:3000/tin-tuc/5-meo-de-ngu-ngon-tren-chuyen-bay-duong-dai \
  | grep -o '<script>alert\|og:type" content="[a-z]*"' | sort -u
# og:type" content="article"      ← và KHÔNG có dòng <script>alert
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/tin-tuc/khong-co     # 404
make fe-typecheck && make fe-lint
git add . && git commit -m "Trang Tin tức và bài viết"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `/tin-tuc` lỗi 500 `newsListOptions is not a function` dù hàm đã có | Lỗi có thật lúc làm bài này: Turbopack của `next dev` giữ bản cũ của `queries.ts`. `make restart s=frontend` |
| Thân bài không có định dạng (tiêu đề như chữ thường) | Chưa đăng ký plugin typography, hoặc thiếu class `prose` |
| Đoạn văn trong bài hẹp hơn khung | `prose` mặc định giới hạn bề rộng ~65 ký tự; thêm `max-w-none` |
