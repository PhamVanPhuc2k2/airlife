# Bài 2.11: Trang chuyên mục Xem/Nghe: chip lọc và cuộn tải thêm

> [← Bài trước](10-trang-chu.md) · [Mục lục](../README.md) · [Bài sau →](12-trinh-phat-youtube.md)

## Mục tiêu

`/xem` và `/nghe`: tiêu đề chuyên mục, chip lọc, sắp xếp "Mới nhất / Xem nhiều", lưới media tự tải
thêm khi cuộn. Trang đầu có sẵn trong HTML.

## Bạn sẽ học

- **Prefetch trên server + `HydrationBoundary`**: kết hợp SEO của server component với tương tác của
  client component.
- Bộ lọc nằm trên **URL**, không nằm trong `useState`.
- `useInfiniteQuery` + `IntersectionObserver` cho cuộn vô tận.

## Viết code

### Bước 1: `frontend/src/components/category/FilterChips.tsx`

```tsx
import Link from "next/link";

import { qs } from "@/lib/api";
import { cn } from "@/lib/cn";

type Props = {
  basePath: string; // "/xem"
  filters: { slug: string; name: string }[];
  activeTag?: string;
  sort: "new" | "popular";
};

// Chip lọc và nút sắp xếp đều là LINK (?f=…&sort=…), không phải nút đổi state:
// - Dán link cho người khác là họ thấy đúng bộ lọc.
// - Bấm "quay lại" của trình duyệt là về bộ lọc trước.
// - Server đọc tham số URL, lấy sẵn dữ liệu đúng bộ lọc.
export function FilterChips({ basePath, filters, activeTag, sort }: Props) {
  const href = (tag?: string, s: string = sort) => {
    const q = qs({ f: tag, sort: s === "popular" ? "popular" : undefined });
    return q ? `${basePath}?${q}` : basePath;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
      active ? "bg-gradient-brand text-white" : "bg-surface-2 text-ink-2 hover:bg-surface-3",
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav
        aria-label="Lọc"
        className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
      >
        <Link
          href={href(undefined)}
          className={chip(!activeTag)}
          aria-current={!activeTag ? "page" : undefined}
        >
          Tất cả
        </Link>
        {filters.map((f) => (
          <Link
            key={f.slug}
            href={href(f.slug)}
            className={chip(activeTag === f.slug)}
            aria-current={activeTag === f.slug ? "page" : undefined}
          >
            {f.name}
          </Link>
        ))}
      </nav>
      <div className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold">
        {(["new", "popular"] as const).map((s) => (
          <Link
            key={s}
            href={href(activeTag, s)}
            aria-current={sort === s ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5",
              sort === s ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {s === "new" ? "Mới nhất" : "Xem nhiều"}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

Bộ lọc là **link** `?f=phim-viet&sort=popular`. Dán link cho bạn bè là họ thấy đúng bộ lọc; nút
"quay lại" về bộ lọc trước; server đọc URL nên lấy sẵn đúng dữ liệu. Nếu để trong `useState`, mất cả
ba điều đó.

### Bước 2: `frontend/src/components/category/MediaGrid.tsx`

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { MediaCard } from "@/components/media/MediaCard";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";

// Lưới media cuộn tải thêm. Trang đầu đã được server lấy sẵn (CategoryPage → prefetch), nên
// lần render đầu có dữ liệu ngay, không có màn "đang tải".
export function MediaGrid(params: MediaListParams) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError, refetch } =
    useInfiniteQuery(mediaListOptions(params));
  const sentinel = useRef<HTMLDivElement>(null);

  // Cuộn tới gần cuối lưới thì tự tải trang tiếp. IntersectionObserver báo khi ô "lính gác"
  // (sentinel) lọt vào màn hình, không phải nghe sự kiện scroll liên tục.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px" }, // tải trước khi khách cuộn tới đáy hẳn
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isError && items.length === 0) {
    return (
      <div className="rounded-card bg-surface p-8 text-center">
        <p className="text-ink-muted">Không tải được danh sách.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 font-semibold text-brand-700"
        >
          Thử lại
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="py-16 text-center text-ink-muted">Chưa có nội dung nào trong mục này.</p>;
  }

  return (
    <>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((m, i) => (
          <MediaCard key={m.id} media={m} priority={i < 4} />
        ))}
      </div>
      <div ref={sentinel} />
      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          {/* Nút dự phòng: trình duyệt cũ, hoặc người dùng bàn phím */}
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="h-10 rounded-full bg-surface-2 px-6 font-semibold text-ink-2 hover:bg-surface-3 disabled:opacity-60"
          >
            {isFetchingNextPage ? "Đang tải…" : "Xem thêm"}
          </button>
        </div>
      )}
    </>
  );
}
```

- **`data.pages`**: mỗi lần tải thêm là một trang; `flatMap` gộp lại thành một danh sách.
- **Ô "lính gác"** (`sentinel`) nằm cuối lưới. `IntersectionObserver` báo khi nó còn cách màn hình
  600px (`rootMargin`) → tải trang tiếp trước khi khách cuộn tới đáy hẳn.
- **Nút "Xem thêm"** vẫn giữ: cho người dùng bàn phím, và phòng trình duyệt không chạy observer.
- `void fetchNextPage()`: hàm trả Promise; `void` báo "cố ý không chờ", để linter không cảnh báo.

### Bước 3: `frontend/src/components/category/CategoryPage.tsx`

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { mediaListOptions } from "@/lib/queries";
import type { Category } from "@/lib/types";

import { FilterChips } from "./FilterChips";
import { MediaGrid } from "./MediaGrid";

type Props = {
  slug: "xem" | "nghe";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Trang chuyên mục Xem / Nghe (dùng chung cho hai route).
//
// "Lấy sẵn trên server, dùng tiếp ở client" (prefetch + HydrationBoundary):
//   1. Server tạo QueryClient, prefetchInfiniteQuery trang đầu.
//   2. dehydrate() chuyển cache đó thành JSON, gửi kèm HTML.
//   3. Ở trình duyệt, HydrationBoundary nạp JSON vào QueryClient; MediaGrid gọi
//      useInfiniteQuery với CÙNG key nên có dữ liệu ngay, rồi tự tải các trang sau.
export async function CategoryPage({ slug, searchParams }: Props) {
  const sp = await searchParams;
  const tag = typeof sp.f === "string" ? sp.f : undefined;
  const sort = sp.sort === "popular" ? "popular" : "new";

  const queryClient = getQueryClient();
  const [category] = await Promise.all([
    api<Category>(`/categories/${slug}`),
    queryClient.prefetchInfiniteQuery(mediaListOptions({ category: slug, tag, sort })),
  ]);

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-5 md:px-6">
      <header>
        <h1 className="text-2xl font-bold md:text-3xl">{category.title}</h1>
        <p className="mt-1 max-w-3xl text-ink-muted">{category.description}</p>
      </header>
      <FilterChips
        basePath={`/${slug}`}
        filters={category.filters ?? []}
        activeTag={tag}
        sort={sort}
      />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <MediaGrid category={slug} tag={tag} sort={sort} />
      </HydrationBoundary>
    </div>
  );
}
```

Luồng dữ liệu:

```text
Server: getQueryClient() mới → prefetchInfiniteQuery(key) → dehydrate() thành JSON
   │                                                              │ gửi kèm HTML
Trình duyệt: HydrationBoundary nạp JSON vào QueryClient của trình duyệt
   └─ MediaGrid: useInfiniteQuery(cùng key) → có dữ liệu ngay, không gọi API lần nữa
```

`Promise.all`: lấy thông tin chuyên mục và trang đầu media **song song**, không chờ lần lượt.

`searchParams` là **Promise** (Next.js 15+): phải `await` mới đọc được.

### Bước 4: Route `/xem` và `/nghe`

#### `frontend/src/app/xem/page.tsx`

```tsx
import type { Metadata } from "next";

import { CategoryPage } from "@/components/category/CategoryPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Xem" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page({ searchParams }: Props) {
  return <CategoryPage slug="xem" searchParams={searchParams} />;
}
```

#### `frontend/src/app/nghe/page.tsx`

```tsx
import type { Metadata } from "next";

import { CategoryPage } from "@/components/category/CategoryPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nghe" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page({ searchParams }: Props) {
  return <CategoryPage slug="nghe" searchParams={searchParams} />;
}
```

Hai file mỏng, gọi chung `CategoryPage`. `metadata.title: "Xem"` + template của layout gốc → tab
trình duyệt hiện "Xem | Airlife".

## Kiểm tra

- http://localhost:3000/xem: 13 phim, chip "Tất cả" sáng.
- Bấm "Phim Việt": URL thành `/xem?f=phim-viet`, còn 3 phim. Bấm "Xem nhiều": `?f=phim-viet&sort=popular`,
  thứ tự đổi theo lượt xem. Bấm "quay lại" của trình duyệt: về bộ lọc trước.
- Thử cuộn tải thêm với trang nhỏ: tạm sửa `limit: 24` thành `limit: 4` trong `queries.ts`, mở `/xem`,
  cuộn xuống: các trang sau tự tải (DevTools → Network thấy `media?...cursor=...`). Sửa lại 24.
- `Ctrl+U` trên `/xem`: tiêu đề phim có sẵn trong HTML, và có khối JSON dữ liệu đã dehydrate.

```bash
make fe-typecheck && make fe-lint
git add . && git commit -m "Trang chuyên mục Xem/Nghe"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Lần đầu mở trang vẫn thấy gọi API `media?...` từ trình duyệt | Key ở server và client khác nhau (vd. `tag` là `undefined` ở một bên, `""` ở bên kia). Dùng chung `mediaListOptions` |
| `searchParams.f` là `undefined` dù URL có `?f=` | Chưa `await searchParams` |
| Cuộn xuống không tải thêm | `hasNextPage` false: API không trả `next_cursor` (hết dữ liệu), hoặc `getNextPageParam` trả `""` thay vì `undefined` |
