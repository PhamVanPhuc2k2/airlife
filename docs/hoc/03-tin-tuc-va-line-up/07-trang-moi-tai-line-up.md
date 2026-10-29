# Bài 3.07: Trang Mới tải và line-up phim theo tháng

> [← Bài trước](06-trang-tin-tuc.md) · [Mục lục](../README.md)

## Mục tiêu

`/moi-tai`: tab Tất cả / Video / Nghe (lưới cuộn tải thêm) và tab "Line-up phim tháng 10/2026"
(poster đứng, chọn tháng). Line-up theo tháng là phần giữ lại từ site cũ skyline.vn.

## Bạn sẽ học

- Một trang, nhiều tab, mỗi tab cách lấy dữ liệu khác nhau.
- Khi nào **không cần** TanStack Query: render hẳn trên server.
- Kiểm tra tham số URL bằng danh sách cho phép.

## Viết code

### Bước 1: `frontend/src/components/lineup/PosterCard.tsx`

```tsx
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
```

Media chỉ có ảnh ngang 16:9; poster đứng 2:3 cắt phần giữa ảnh (`object-cover`). Comment ghi cách làm
khi có ảnh poster thật.

### Bước 2: `frontend/src/app/moi-tai/page.tsx`

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";

import { MediaGrid } from "@/components/category/MediaGrid";
import { PosterCard } from "@/components/lineup/PosterCard";
import { ChipLinks } from "@/components/ui/ChipLinks";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";
import { api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { type MediaListParams, mediaListOptions } from "@/lib/queries";
import type { MediaPage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Mới tải",
  description: "Video, podcast và line-up phim vừa được cập nhật lên Airlife.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Tab của trang (mockup: Tất cả / Video / Nghe / Line-up phim tháng). Video, Nghe chính là
// chuyên mục xem, nghe; "Tất cả" là mọi chuyên mục, mới nhất trước.
const MEDIA_TABS: Record<string, { label: string; params: MediaListParams }> = {
  all: { label: "Tất cả", params: { sort: "new" } },
  video: { label: "Video", params: { category: "xem", sort: "new" } },
  audio: { label: "Nghe", params: { category: "nghe", sort: "new" } },
};

// "2026-10" → "10/2026"
const monthLabel = (m: string) => m.split("-").reverse().join("/");

export default async function NewUploadsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const tab =
    typeof sp.tab === "string" && (sp.tab in MEDIA_TABS || sp.tab === "line-up") ? sp.tab : "all";

  // Tháng line-up: tab cần để đặt tên ("Line-up phim tháng 10/2026") nên luôn lấy
  const months = await api<string[]>("/lineup/months");
  const latestMonth = months[0];

  const tabs = [
    ...Object.entries(MEDIA_TABS).map(([key, t]) => ({
      href: key === "all" ? "/moi-tai" : `/moi-tai?tab=${key}`,
      label: t.label,
      active: tab === key,
    })),
    ...(latestMonth
      ? [
          {
            href: "/moi-tai?tab=line-up",
            label: `Line-up phim tháng ${monthLabel(latestMonth)}`,
            active: tab === "line-up",
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-5 md:px-6">
      <PageHead
        icon="sparkle"
        title="Mới tải"
        desc="Video, podcast và phim vừa được cập nhật lên Airlife."
      />
      <TabLinks items={tabs} label="Loại nội dung" />
      {tab === "line-up" ? (
        <Lineup months={months} selected={typeof sp.thang === "string" ? sp.thang : latestMonth} />
      ) : (
        <MediaTab params={MEDIA_TABS[tab]!.params} />
      )}
    </div>
  );
}

async function MediaTab({ params }: { params: MediaListParams }) {
  const queryClient = getQueryClient();
  await queryClient.prefetchInfiniteQuery(mediaListOptions(params));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MediaGrid {...params} />
    </HydrationBoundary>
  );
}

// Line-up phim theo tháng (giữ từ site cũ skyline.vn). Mỗi tháng vài chục phim, hiện hết một
// lần, không cần cuộn tải thêm: render hẳn trên server.
async function Lineup({ months, selected }: { months: string[]; selected?: string }) {
  if (!selected) return <p className="py-16 text-center text-ink-muted">Chưa có line-up.</p>;
  const page = await api<MediaPage>(`/media?lineup=${encodeURIComponent(selected)}&limit=60`);

  return (
    <div className="space-y-6">
      {months.length > 1 && (
        <ChipLinks
          label="Chọn tháng"
          items={months.map((m) => ({
            href: `/moi-tai?tab=line-up&thang=${m}`,
            label: `Tháng ${monthLabel(m)}`,
            active: m === selected,
          }))}
        />
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {page.items.map((m, i) => (
          <PosterCard key={m.id} media={m} isNew={i < 4} />
        ))}
      </div>
    </div>
  );
}
```

- **`tab` chỉ nhận giá trị trong danh sách**: `?tab=abc` hay `?tab=<script>` đều về `all`. Tham số URL
  là dữ liệu do người dùng gửi, luôn kiểm tra.
- **Tab Video/Nghe dùng lại `MediaGrid`** với `category` khác; tab "Tất cả" không truyền `category`
  (bài 3.05 đã cho phép bỏ trống).
- **Tab Line-up không dùng TanStack Query**: mỗi tháng vài chục phim, hiện hết một lần, không cuộn tải
  thêm, không tương tác. Server component `async` lấy và render luôn; trình duyệt không nhận JavaScript
  nào cho phần này.
- **`MediaTab`, `Lineup` là async component**: component server được phép `async/await` ngay trong thân.
- **Bộ chọn tháng chỉ hiện khi có từ 2 tháng trở lên**.

## Kiểm tra

- http://localhost:3000/moi-tai: tab "Tất cả" gồm cả phim và podcast, mới nhất trước. Menu dọc sáng "Mới tải".
- Tab "Video": chỉ phim; tab "Nghe": chỉ âm thanh.
- Tab "Line-up phim tháng 10/2026": 6 poster, 4 cái đầu có nhãn "Mới".
- `/moi-tai?tab=abc`: về tab "Tất cả", không lỗi.

Thử nhiều tháng: đưa một phim sang line-up tháng trước rồi mở lại tab Line-up:

```bash
docker compose exec postgres psql -U airlife -c \
  "UPDATE media SET lineup_month = '2026-09-01' WHERE slug = 'ghe-12a';"
```

Có bộ chọn "Tháng 10/2026 / Tháng 09/2026"; bấm tháng 9 thấy "Ghế 12A". `make seed` để trả về như cũ.

```bash
make fe-typecheck && make fe-lint && make fe-audit
make lint && make vuln
git add . && git commit -m "Trang Mới tải, line-up phim theo tháng"
```

Đến đây xong Phần 03.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Tab line-up trống | `/lineup/months` trả `[]`: chưa seed |
| `MEDIA_TABS[tab]` báo có thể `undefined` | `noUncheckedIndexedAccess` (bài 1.02). `tab` đã được kiểm tra nằm trong danh sách nên dùng `!` |
