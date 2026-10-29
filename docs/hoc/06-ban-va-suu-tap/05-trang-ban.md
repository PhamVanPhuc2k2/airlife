# Bài 6.05: Trang Bạn: số liệu, tiếp tục xem, kênh đang theo dõi

> [← Bài trước](04-nut-luu-va-playlist.md) · [Mục lục](../README.md) · [Bài sau →](06-trang-suu-tap.md)

## Mục tiêu

Trang `/ban` theo mockup (`renderMe`): thẻ hồ sơ, bốn con số (Đang theo dõi, Đã lưu, Playlist, Đã xem),
hàng "Tiếp tục xem", lưới "Kênh đang theo dõi". Chuyến bay sắp tới (Phần 10) và đơn hàng (Phần 07) thêm sau.

## Bạn sẽ học

- Trang toàn dữ liệu riêng: server chỉ dựng khung, các khối tự lấy dữ liệu ở trình duyệt.
- Hai component dùng chung một key truy vấn thì chỉ gọi API một lần.
- Ẩn cả khối khi không có dữ liệu, thay vì hiện khung trống.

## Viết code

### Bước 1: Tên loại kênh dùng chung, `frontend/src/components/channel/labels.ts`

Trang kênh (bài 5.06) có bảng `TYPE_LABEL` riêng; trang Bạn cũng cần. Tách ra một file:

```ts
import type { ChannelDetail } from "@/lib/types";

// Tên loại kênh (trang kênh, danh sách kênh đang theo dõi ở trang Bạn)
export const CHANNEL_TYPE_LABEL: Record<ChannelDetail["type"], string> = {
  distributor: "Nhà phân phối nội dung",
  creator: "Nhà sáng tạo",
  business: "Doanh nghiệp",
  travel: "Doanh nghiệp lữ hành",
};
```

Trong `frontend/src/app/kenh/[slug]/page.tsx`: xoá hằng `TYPE_LABEL`, import `CHANNEL_TYPE_LABEL` từ
`@/components/channel/labels`, và dùng `{CHANNEL_TYPE_LABEL[channel.type]}`.

### Bước 2: Bốn con số, `frontend/src/components/account/LibraryStats.tsx`

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { api } from "@/lib/api";
import type { LibraryStats as Stats } from "@/lib/types";

// Bốn con số dưới thẻ hồ sơ (mockup: profile__stats). Bấm vào là tới đúng tab Sưu tập.
export function LibraryStats() {
  const { data } = useQuery({
    queryKey: ["me", "stats"],
    queryFn: () => api<Stats>("/me/stats"),
  });
  const items = [
    { label: "Đang theo dõi", value: data?.following, href: "#kenh-theo-doi" },
    { label: "Đã lưu", value: data?.saved, href: "/suu-tap?tab=da-luu" },
    { label: "Playlist", value: data?.playlists, href: "/suu-tap" },
    { label: "Đã xem", value: data?.watched, href: "/suu-tap?tab=da-xem" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <li key={it.label}>
          <Link
            href={it.href}
            className="block rounded-card bg-surface p-4 text-center shadow-sm ring-1 ring-ink/[0.07] transition hover:ring-brand-300"
          >
            <b className="block text-2xl font-bold">{it.value ?? "–"}</b>
            <small className="text-sm text-ink-muted">{it.label}</small>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

Mỗi ô là link tới đúng tab Sưu tập. Ô "Đang theo dõi" cuộn xuống lưới kênh trong cùng trang (`#kenh-theo-doi`).

### Bước 3: `frontend/src/components/account/ContinueWatching.tsx`

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { MediaCard } from "@/components/media/MediaCard";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";

// Hàng "Tiếp tục xem" ở trang Bạn: những nội dung xem dở, mới xem nhất trước. Trên điện thoại
// vuốt ngang (như 3 ô ở trang chủ), màn rộng thì thành lưới.
export function ContinueWatching() {
  const { data, isPending } = useQuery({
    queryKey: ["me", "continue"],
    queryFn: () => api<LibraryItem[]>("/me/continue"),
  });
  if (isPending) return <div className="h-56 animate-pulse rounded-card bg-surface-2" />;
  if (!data?.length) return null; // chưa xem dở gì: ẩn cả khối

  return (
    <section aria-labelledby="tiep-tuc-xem">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="tiep-tuc-xem" className="text-xl font-bold">
          Tiếp tục xem
        </h2>
        <Link href="/suu-tap?tab=da-xem" className="text-sm font-semibold text-brand-700">
          Xem tất cả
        </Link>
      </div>
      <div className="-mx-3 flex snap-x gap-4 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {data.slice(0, 6).map((m) => (
          <div key={m.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
            <MediaCard media={m} progress={m.progress} />
          </div>
        ))}
      </div>
    </section>
  );
}
```

Chưa xem dở gì thì `return null`: khối "Tiếp tục xem" trống chỉ chiếm chỗ.

### Bước 4: `frontend/src/components/account/FollowingChannels.tsx`

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { CHANNEL_TYPE_LABEL } from "@/components/channel/labels";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber } from "@/lib/format";
import type { ChannelBrief } from "@/lib/types";

// Lưới kênh đang theo dõi ở trang Bạn. Cùng key với danh sách ở menu dọc (Sidebar), nên chỉ
// gọi API một lần cho cả hai, và cùng được làm mới khi bấm Theo dõi.
export function FollowingChannels() {
  const { data, isPending } = useQuery({
    queryKey: ["me", "following"],
    queryFn: () => api<ChannelBrief[]>("/me/following"),
  });
  if (isPending) return null;

  return (
    <section aria-labelledby="kenh-theo-doi-title" id="kenh-theo-doi" className="scroll-mt-24">
      <h2 id="kenh-theo-doi-title" className="mb-4 text-xl font-bold">
        Kênh đang theo dõi
      </h2>
      {data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/kenh/${c.slug}`}
                className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07] transition hover:ring-brand-300"
              >
                <Avatar name={c.name} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-semibold">
                    <span className="truncate">{c.name}</span>
                    {c.verified && <Icon name="check" className="size-4 shrink-0 text-brand-600" />}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">
                    {CHANNEL_TYPE_LABEL[c.type]} · {compactNumber(c.followers_count)} theo dõi
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface p-6 text-center text-ink-muted">
          Bạn chưa theo dõi kênh nào. Bấm “Theo dõi” ở trang kênh hoặc trang xem để thấy kênh ở đây.
        </p>
      )}
    </section>
  );
}
```

Key `["me", "following"]` trùng với danh sách ở menu dọc (bài 5.08): TanStack Query gọi `/me/following`
một lần cho cả hai chỗ.

### Bước 5: Trang, `frontend/src/app/ban/page.tsx`

```tsx
import type { Metadata } from "next";

import { ContinueWatching } from "@/components/account/ContinueWatching";
import { FollowingChannels } from "@/components/account/FollowingChannels";
import { LibraryStats } from "@/components/account/LibraryStats";
import { ProfileCard } from "@/components/account/ProfileCard";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn (mockup: renderMe). Mọi khối là dữ liệu riêng của người đang đăng nhập nên lấy ở
// trình duyệt (có cookie). Mockup còn có chuyến bay sắp tới (Phần 10) và đơn hàng (Phần 07).
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-3 py-6 md:px-6">
      <div className="space-y-3">
        <ProfileCard />
        <LibraryStats />
      </div>
      <ContinueWatching />
      <FollowingChannels />
    </div>
  );
}
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Tài khoản mới, mở `/ban` | Bốn số đều 0; không có khối "Tiếp tục xem"; "Bạn chưa theo dõi kênh nào…" |
| Xem dở một phim quá 30 giây, dừng, mở `/ban` | "Tiếp tục xem" có phim đó, vạch đỏ đúng chỗ dừng; số "Đã xem" là 1 |
| Theo dõi một kênh, quay lại `/ban` | Lưới kênh có kênh đó; số "Đang theo dõi" là 1 |
| Bấm ô "Đã lưu" | Sang `/suu-tap?tab=da-luu` |
| Màn 390px | Bốn số thành lưới 2×2; "Tiếp tục xem" vuốt ngang |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Số liệu không đổi sau khi lưu hoặc xem | Mutation chưa gọi `useInvalidateLibrary` (key `["me","stats"]`) |
| Trang kênh lỗi `TYPE_LABEL is not defined` | Đã xoá hằng ở bước 1 nhưng chưa đổi chỗ dùng |
