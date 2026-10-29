# Bài 2.10: Thẻ media và trang chủ

> [← Bài trước](09-tanstack-query.md) · [Mục lục](../README.md) · [Bài sau →](11-trang-chuyen-muc.md)

## Mục tiêu

Trang chủ thật theo bố cục mockup: 3 ô bên trái, khối nổi bật, cột "Nghe nhiều", hàng "Đang được
xem nhiều". Trang tạm của Phần 01 và nút "Phát thử" bị xoá.

## Bạn sẽ học

- **Server component lấy dữ liệu**: `async function` + `await api(...)`, không cần `useEffect`.
- `next/image`: `fill` + `sizes` để trình duyệt tải ảnh vừa cỡ.
- `export const dynamic = "force-dynamic"` và vì sao cần nó ở đây.
- `suppressHydrationWarning` cho thời gian tương đối.

## Viết code

### Bước 1: Dọn đồ tạm

```bash
rm -rf frontend/src/components/dev
```

Thêm icon `check` vào `LINE_ICONS` trong `frontend/src/components/icons/Icon.tsx` (dấu tích kênh đã xác minh):

```tsx
  check: <path d="m5 12 5 5 9-10" />,
```

### Bước 2: Component nhỏ dùng chung

#### `frontend/src/components/ui/Avatar.tsx`

```tsx
import { cn } from "@/lib/cn";

// Avatar chữ cái đầu, màu cố định theo tên (chưa có ảnh đại diện thật). Theo mockup.
const COLORS = [
  "#6c3c8b",
  "#c86e3a",
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#10b981",
];

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-10 text-sm",
  lg: "size-[72px] text-2xl",
};

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof SIZES }) {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        SIZES[size],
      )}
      style={{ background: COLORS[sum % COLORS.length] }}
    >
      {initials(name)}
    </span>
  );
}
```

#### `frontend/src/components/ui/Panel.tsx`

```tsx
import Link from "next/link";

import { Icon, type IconName } from "@/components/icons/Icon";

// Khung trắng có tiêu đề và link "Tất cả" (mockup: .panel).
export function Panel({
  title,
  icon,
  moreHref,
  children,
}: {
  title: string;
  icon?: IconName;
  moreHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-[18px] shadow-sm ring-1 ring-ink/[0.07]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {icon && <Icon name={icon} className="text-brand-600" />}
          {title}
        </h2>
        {moreHref && (
          <Link href={moreHref} className="text-sm font-semibold text-brand-700 hover:underline">
            Tất cả
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
```

#### `frontend/src/components/media/links.ts`

```ts
import type { MediaCard } from "@/lib/types";

// Đường dẫn trang xem: /xem/<slug> hoặc /nghe/<slug>
export function mediaHref(m: Pick<MediaCard, "category" | "slug">): string {
  return `/${m.category}/${m.slug}`;
}

// "lượt xem" cho video, "lượt nghe" cho âm thanh
export function viewWord(m: Pick<MediaCard, "kind">): string {
  return m.kind === "audio" ? "lượt nghe" : "lượt xem";
}
```

### Bước 3: Các kiểu thẻ media

#### `frontend/src/components/media/MediaCard.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard as Media } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Thẻ media trong lưới (trang chủ, chuyên mục). Ảnh 16:9, nhãn thời lượng góc dưới phải,
// avatar kênh + tiêu đề + "1,1 Tr lượt xem · 2 tuần trước" như mockup.
export function MediaCard({ media, priority = false }: { media: Media; priority?: boolean }) {
  const href = mediaHref(media);
  const duration = durationLabel(media);
  return (
    <article className="group">
      <Link href={href} className="block" tabIndex={-1} aria-hidden="true">
        <div className="relative aspect-video overflow-hidden rounded-card bg-surface-3">
          <Image
            src={media.thumbnail_url}
            alt=""
            fill
            priority={priority}
            // Trình duyệt chọn cỡ ảnh vừa đủ theo bề rộng thẻ trên từng màn hình
            sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-brand group-hover:scale-105"
          />
          {duration && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
              {duration}
            </span>
          )}
        </div>
      </Link>
      <div className="mt-3 flex gap-3">
        <Avatar name={media.channel.name} size="sm" />
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link href={href} className="hover:text-brand-700">
              {media.title}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
            {media.channel.name}
            {media.channel.verified && (
              <span title="Kênh đã xác minh">
                <Icon name="check" className="size-3.5 text-brand-600" />
                <span className="sr-only">(đã xác minh)</span>
              </span>
            )}
          </p>
          <p className="text-sm text-ink-muted">
            {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
            {/* Server và trình duyệt tính "x phút trước" ở hai thời điểm khác nhau một chút */}
            <time dateTime={media.published_at} suppressHydrationWarning>
              {timeAgo(media.published_at)}
            </time>
          </p>
        </div>
      </div>
    </article>
  );
}
```

- **`fill` + `sizes`**: ảnh phủ kín khung cha (`relative aspect-video`). `sizes` báo trình duyệt "trên
  màn ≥ 1280px ảnh chiếm 25% bề ngang", để nó tải bản ảnh vừa đủ, không tải ảnh 2000px cho ô 300px.
- **Link ảnh có `tabIndex={-1}` và `aria-hidden`**: ảnh và tiêu đề cùng dẫn tới một trang. Người dùng
  bàn phím chỉ cần Tab qua **một** link (tiêu đề), trình đọc màn hình không đọc hai lần.
- **`suppressHydrationWarning`** trên `<time>`: server tính "5 phút trước", trình duyệt chạy lại lúc
  đã sang phút sau thành "6 phút trước"; React báo lệch (hydration mismatch). Chỗ này lệch là bình thường.

#### `frontend/src/components/media/MediaTile.tsx`

```tsx
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
```

#### `frontend/src/components/media/FeaturedHero.tsx`

```tsx
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
```

`priority`: ảnh lớn nhất màn hình đầu được tải ngay, không đợi lazy-load. Chỉ số LCP (thời gian phần
tử lớn nhất hiện ra) quyết định cảm giác "trang nhanh hay chậm".

#### `frontend/src/components/media/RankList.tsx`

```tsx
import Image from "next/image";
import Link from "next/link";

import { compactNumber, durationLabel } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Danh sách xếp hạng có số thứ tự (khối "Nghe nhiều" của mockup).
export function RankList({ items }: { items: MediaCard[] }) {
  return (
    <ol className="grid gap-3">
      {items.map((m, i) => (
        <li key={m.id}>
          <Link href={mediaHref(m)} className="group flex items-center gap-3">
            <span className="w-6 shrink-0 text-center text-2xl font-bold text-brand-600">
              {i + 1}
            </span>
            <span className="relative size-[72px] shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
              <Image src={m.thumbnail_url} alt="" fill sizes="72px" className="object-cover" />
              <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
                {durationLabel(m)}
              </span>
            </span>
            <span className="grid min-w-0">
              <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
                {m.title}
              </strong>
              <small className="truncate text-ink-muted">{m.channel.name}</small>
              <small className="text-ink-muted">
                {compactNumber(m.view_count)} {viewWord(m)}
              </small>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
```

### Bước 4: `frontend/src/app/page.tsx`

```tsx
import { FeaturedHero } from "@/components/media/FeaturedHero";
import { MediaCard } from "@/components/media/MediaCard";
import { MediaTile } from "@/components/media/MediaTile";
import { RankList } from "@/components/media/RankList";
import { Panel } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import type { Home } from "@/lib/types";

// Trang lấy dữ liệu từ API lúc có request, không dựng sẵn lúc build (lúc build không có API
// để gọi). Dữ liệu đã được backend cache 60 giây bằng Redis.
export const dynamic = "force-dynamic";

// Server component: lấy dữ liệu ngay trên server, gửi về HTML có sẵn nội dung (tốt cho SEO,
// hiện nhanh), không có JavaScript nào cho phần này chạy trên trình duyệt.
export default async function HomePage() {
  const home = await api<Home>("/home");

  return (
    <div className="mx-auto max-w-[1680px] space-y-8 px-3 py-4 md:px-6 md:py-6">
      {/* Bố cục theo bản vẽ tay của mockup: 3 ô | khối nổi bật | cột phải.
          Cột phải sẽ là "Bình luận nổi bật" (Phần 04); tạm đặt "Nghe nhiều". */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)_minmax(280px,1fr)]">
        <div className="lg:order-2">{home.featured && <FeaturedHero media={home.featured} />}</div>

        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 [scrollbar-width:none] lg:order-1 lg:mx-0 lg:grid lg:grid-rows-3 lg:overflow-visible lg:px-0">
          {home.latest.map((m) => (
            <div key={m.id} className="w-[72%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
              <MediaTile media={m} />
            </div>
          ))}
        </div>

        <div className="lg:order-3 lg:col-span-2 xl:col-span-1">
          <Panel title="Nghe nhiều" icon="sound" moreHref="/nghe?sort=popular">
            <RankList items={home.top_listen} />
          </Panel>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Đang được xem nhiều</h2>
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
          {home.trending.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- **Không có `"use client"`**: trang chạy hoàn toàn trên server, trình duyệt nhận HTML đã có nội dung,
  không tải JavaScript cho phần này. Công cụ tìm kiếm đọc được ngay.
- **`force-dynamic`**: mặc định Next.js thử dựng sẵn trang lúc `npm run build`. Lúc build (trong Docker)
  không có API để gọi → build lỗi. `force-dynamic` = luôn dựng lúc có request.
- **Thứ tự hiển thị**: HTML có khối nổi bật **trước** 3 ô (`lg:order-*` chỉ đổi vị trí trên màn rộng).
  Điện thoại và trình đọc màn hình gặp nội dung chính trước.
- Cột phải mockup là "Bình luận nổi bật" (cần Phần 04); tạm đặt "Nghe nhiều".

## Kiểm tra

Mở http://localhost:3000:
- ≥ 1280px: 3 ô | khối nổi bật | Nghe nhiều; bên dưới 4 thẻ "Đang được xem nhiều".
- Điện thoại: khối nổi bật trước, 3 ô vuốt ngang, rồi Nghe nhiều, rồi 4 thẻ.
- `Ctrl+U` (xem mã nguồn): tiêu đề "Vùng Trời Cuối Cùng" nằm sẵn trong HTML.

```bash
make fe-typecheck && make fe-lint
git add . && git commit -m "Thẻ media và trang chủ"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `Image with src "..." has "fill" but is missing "sizes" prop` | Thêm `sizes` |
| Ảnh `fill` tràn ra cả trang | Khung cha thiếu `relative` (hoặc thiếu kích thước) |
| Lần đầu mở trang ảnh hiện chậm | Next.js tải ảnh gốc từ picsum rồi nén; lần sau lấy từ cache `.next/cache/images` |
| Build báo `ECONNREFUSED` khi `npm run build` | Trang lấy dữ liệu thiếu `export const dynamic = "force-dynamic"` |
