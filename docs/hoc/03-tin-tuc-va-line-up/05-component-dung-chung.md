# Bài 3.05: Tách component dùng chung ở frontend

> [← Bài trước](04-module-news.md) · [Mục lục](../README.md) · [Bài sau →](06-trang-tin-tuc.md)

## Mục tiêu

`LoadMore`, `ChipLinks`, `TabLinks`, `PageHead` dùng chung cho mọi trang danh sách. `MediaGrid` và
`FilterChips` (Phần 02) chuyển sang dùng chúng. Thêm kiểu dữ liệu, truy vấn cho tin tức.

## Bạn sẽ học

- Refactor frontend giống backend (bài 3.01): tách khi có lần dùng thứ hai.
- `formatDate` với múi giờ cố định để server và trình duyệt cho cùng kết quả.

## Viết code

### Bước 1: `frontend/src/components/ui/LoadMore.tsx`

Phần "lính gác + IntersectionObserver + nút Xem thêm" của `MediaGrid` (bài 2.11) chuyển thành component riêng:

```tsx
"use client";

import { useEffect, useRef } from "react";

type Props = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

// Cuộn tới gần cuối danh sách thì tự tải trang tiếp (ô "lính gác" + IntersectionObserver),
// kèm nút "Xem thêm" dự phòng. Dùng chung cho mọi danh sách useInfiniteQuery.
export function LoadMore({ hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const sentinel = useRef<HTMLDivElement>(null);

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

  return (
    <>
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

`MediaGrid` gọn lại, bản đầy đủ:

```tsx
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { MediaCard } from "@/components/media/MediaCard";
import { LoadMore } from "@/components/ui/LoadMore";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";

// Lưới media cuộn tải thêm (LoadMore). Trang đầu đã được server lấy sẵn (CategoryPage → prefetch),
// nên lần render đầu có dữ liệu ngay, không có màn "đang tải".
export function MediaGrid(params: MediaListParams) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError, refetch } =
    useInfiniteQuery(mediaListOptions(params));
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
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </>
  );
}
```

### Bước 2: `frontend/src/components/ui/ChipLinks.tsx`

```tsx
import Link from "next/link";

import { cn } from "@/lib/cn";

export type ChipLink = { href: string; label: string; active: boolean };

// Hàng chip lọc dạng LINK (bộ lọc nằm trên URL, xem bài 2.11). Điện thoại: vuốt ngang.
export function ChipLinks({ items, label = "Lọc" }: { items: ChipLink[]; label?: string }) {
  return (
    <nav
      aria-label={label}
      className="-mx-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
    >
      {items.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          aria-current={c.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
            c.active
              ? "bg-gradient-brand text-white"
              : "bg-surface-2 text-ink-2 hover:bg-surface-3",
          )}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
```

`FilterChips` (bài 2.11) dùng `ChipLinks` cho hàng chip, chỉ còn giữ nút sắp xếp riêng:

```tsx
import Link from "next/link";

import { ChipLinks } from "@/components/ui/ChipLinks";
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ChipLinks
        items={[
          { href: href(undefined), label: "Tất cả", active: !activeTag },
          ...filters.map((f) => ({
            href: href(f.slug),
            label: f.name,
            active: activeTag === f.slug,
          })),
        ]}
      />
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

### Bước 3: `TabLinks` và `PageHead`

#### `frontend/src/components/ui/TabLinks.tsx`

```tsx
import Link from "next/link";

import { cn } from "@/lib/cn";

import type { ChipLink } from "./ChipLinks";

// Thanh tab gạch chân (mockup: .tabs). Mỗi tab là một link ?tab=… để dán link là mở đúng tab.
export function TabLinks({ items, label }: { items: ChipLink[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="-mx-3 flex gap-6 overflow-x-auto border-b border-ink/[0.07] px-3 [scrollbar-width:none] md:mx-0 md:px-0"
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "relative shrink-0 py-3 font-semibold transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full",
            t.active
              ? "text-brand-700 after:bg-gradient-brand"
              : "text-ink-muted after:bg-transparent hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

Gạch chân tab đang chọn vẽ bằng `after:` (pseudo-element `::after`): một thanh 3px nằm đè lên đường
viền dưới của cả hàng (`after:-bottom-px`).

#### `frontend/src/components/ui/PageHead.tsx`

```tsx
import { Icon, type IconName } from "@/components/icons/Icon";

// Đầu trang: icon trong ô gradient, tiêu đề, mô tả (mockup: pageHead()).
export function PageHead({ icon, title, desc }: { icon: IconName; title: string; desc: string }) {
  return (
    <header className="flex items-start gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-card-sm bg-gradient-brand text-white shadow-brand">
        <Icon name={icon} className="size-6" />
      </span>
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-ink-muted">{desc}</p>
      </div>
    </header>
  );
}
```

### Bước 4: Kiểu, truy vấn, định dạng ngày

Thêm vào cuối `frontend/src/lib/types.ts`:

```ts
export type NewsCategory = {
  slug: string;
  name: string;
  description: string;
};

export type NewsCard = {
  id: string;
  slug: string;
  category: string;
  category_name: string;
  title: string;
  excerpt: string;
  cover_url: string;
  author: string;
  published_at: string;
};

// body_html đã được backend lọc bằng bluemonday trước khi lưu (backend/pkg/sanitize)
export type Article = NewsCard & {
  body_html: string;
  updated_at: string;
};

export type NewsPage = {
  items: NewsCard[];
  next_cursor?: string;
};
```

`frontend/src/lib/queries.ts`: `category` của media thành **không bắt buộc** (trang Mới tải lấy mọi chuyên
mục), thêm `newsListOptions`. Bản đầy đủ:

```ts
import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type { MediaPage, NewsPage } from "./types";

// Mỗi truy vấn khai báo một lần (key + hàm lấy dữ liệu) bằng infiniteQueryOptions, dùng chung
// cho server (prefetch) và client (useInfiniteQuery). Key giống nhau thì client nhận lại đúng
// dữ liệu server đã lấy.

export type MediaListParams = {
  category?: string; // bỏ trống = mọi chuyên mục (trang Mới tải)
  tag?: string;
  sort?: "new" | "popular";
};

export function mediaListOptions(p: MediaListParams) {
  return infiniteQueryOptions({
    queryKey: ["media", "list", p.category ?? "", p.tag ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<MediaPage>(
        `/media?${qs({ category: p.category, tag: p.tag, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal }, // rời trang giữa chừng thì huỷ request
      ),
    initialPageParam: "",
    // next_cursor rỗng → undefined → TanStack hiểu là hết trang
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function newsListOptions(category?: string) {
  return infiniteQueryOptions({
    queryKey: ["news", "list", category ?? ""],
    queryFn: ({ pageParam, signal }) =>
      api<NewsPage>(`/news?${qs({ category, cursor: pageParam, limit: 12 })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

Thêm vào cuối `frontend/src/lib/format.ts`:

```ts
// "20/10/2026". Ghi rõ múi giờ Việt Nam: server (container, giờ UTC) và trình duyệt cho ra cùng
// một ngày, không bị lệch khi bài đăng lúc gần nửa đêm.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
```

Container Node chạy giờ UTC. Bài đăng 01:00 sáng 21/10 giờ Việt Nam là 18:00 ngày 20/10 giờ UTC. Không
ghi múi giờ thì server in "20/10", trình duyệt người dùng in "21/10", React báo lệch.

## Kiểm tra

```bash
make fe-format && make fe-typecheck && make fe-lint
```

Mở `/xem`: vẫn chip lọc, sắp xếp, cuộn tải thêm như trước (đổi bên trong, bên ngoài phải y hệt).

```bash
git add . && git commit -m "Tách component dùng chung"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Sau refactor, `/xem` không tự tải thêm | Quên truyền `fetchNextPage` / `hasNextPage` vào `LoadMore` |
| Ngày hiện lệch một ngày | Thiếu `timeZone` trong `toLocaleDateString` |
