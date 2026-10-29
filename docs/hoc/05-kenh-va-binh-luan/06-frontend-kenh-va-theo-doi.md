# Bài 5.06: Frontend: trang kênh và nút Theo dõi

> [← Bài trước](05-du-lieu-mau-va-thu-api.md) · [Mục lục](../README.md) · [Bài sau →](07-frontend-binh-luan.md)

## Mục tiêu

- Trang `/kenh/[slug]` (mockup `kenh.html`): ảnh bìa, thông tin kênh, nút Theo dõi, lưới nội dung của kênh.
- Nút Theo dõi dùng chung ở trang kênh và trang xem; tên kênh trên thẻ media dẫn tới trang kênh.

## Bạn sẽ học

- Trang dựng ở server không có cookie của khách: trạng thái riêng của từng người phải lấy lại ở trình duyệt.
- Cập nhật lạc quan (optimistic update) bằng `useMutation`: `onMutate`, `onError`, `onSuccess`.
- Làm mới một truy vấn khác sau khi ghi (`invalidateQueries`).

## Viết code

### Bước 1: Kiểu dữ liệu và truy vấn

Thêm vào cuối `frontend/src/lib/types.ts` (và `hot_comments` vào kiểu `Home`, dùng ở bài 5.08):

```ts
// Kiểu dữ liệu API trả về. Khớp với DTO bên Go (backend/internal/media/dto.go,
// internal/category, internal/home). Đổi bên Go thì sửa ở đây.

export type Category = {
  slug: string;
  name: string;
  icon: string;
  title: string;
  description: string;
  filters?: { slug: string; name: string }[];
};

export type Channel = {
  slug: string;
  name: string;
  verified: boolean;
  followers_count?: number;
};

export type MediaCard = {
  id: string;
  slug: string;
  kind: "video" | "audio";
  category: string;
  title: string;
  description?: string;
  group_label: string;
  genre_label: string;
  youtube_id: string | null;
  thumbnail_url: string;
  duration_seconds: number | null;
  episode_count: number | null;
  view_count: number;
  featured: boolean;
  published_at: string;
  channel: Channel;
};

export type MediaDetail = MediaCard & {
  tags: string[];
  category_name: string;
  lineup_month: string | null;
};

export type MediaPage = {
  items: MediaCard[];
  next_cursor?: string;
};

export type Home = {
  featured: MediaCard | null;
  latest: MediaCard[];
  trending: MediaCard[];
  top_listen: MediaCard[];
  hot_comments: { top: HotComment[]; replied: HotComment[] };
};

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

// Tài khoản đang đăng nhập (GET /auth/me). Khớp backend/internal/auth/service.go: User
export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "creator" | "business" | "editor" | "admin";
  email_verified: boolean;
  created_at: string;
};

// Trang kênh (GET /channels/{slug}). following: người đang xem có theo dõi không
export type ChannelDetail = {
  slug: string;
  name: string;
  type: "distributor" | "creator" | "business" | "travel";
  verified: boolean;
  followers_count: number;
  description: string;
  avatar_url: string | null;
  media_count: number;
  following: boolean;
};

export type ChannelBrief = { slug: string; name: string; verified: boolean };

export type Comment = {
  id: string;
  author: { id: string; display_name: string; avatar_url: string | null };
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  liked_by_me: boolean;
  mine: boolean;
};

export type CommentPage = { items: Comment[]; next_cursor?: string };

export type HotComment = Comment & { media: { slug: string; category: string; title: string } };
```

`frontend/src/lib/queries.ts`: `MediaListParams` có thêm `channel`, và `channel` phải nằm trong
`queryKey`. Quên thì trang kênh A và trang kênh B dùng chung một bộ nhớ đệm, hiện nhầm nội dung.
Hai hàm bình luận dùng ở bài 5.07. Bản đầy đủ:

```ts
import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type { CommentPage, MediaPage, NewsPage } from "./types";

// Mỗi truy vấn khai báo một lần (key + hàm lấy dữ liệu) bằng infiniteQueryOptions, dùng chung
// cho server (prefetch) và client (useInfiniteQuery). Key giống nhau thì client nhận lại đúng
// dữ liệu server đã lấy.

export type MediaListParams = {
  category?: string; // bỏ trống = mọi chuyên mục (trang Mới tải)
  tag?: string;
  channel?: string; // trang kênh
  sort?: "new" | "popular";
};

export function mediaListOptions(p: MediaListParams) {
  return infiniteQueryOptions({
    queryKey: ["media", "list", p.category ?? "", p.tag ?? "", p.channel ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<MediaPage>(
        `/media?${qs({ category: p.category, tag: p.tag, channel: p.channel, sort: p.sort, cursor: pageParam, limit: 24 })}`,
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

export type CommentTarget = { kind: "media" | "news"; slug: string };

// Bình luận của một media/bài viết. Lấy ở trình duyệt (có cookie) vì kèm liked_by_me, mine.
export function commentsOptions(t: CommentTarget, sort: "top" | "new") {
  return infiniteQueryOptions({
    queryKey: ["comments", t.kind, t.slug, sort],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/${t.kind}/${t.slug}/comments?${qs({ sort, cursor: pageParam })}`, {
        signal,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function repliesOptions(commentId: string) {
  return infiniteQueryOptions({
    queryKey: ["comments", "replies", commentId],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/comments/${commentId}/replies?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

### Bước 2: `frontend/src/components/channel/FollowButton.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";
import type { ChannelDetail } from "@/lib/types";

type FollowState = { following: boolean; followers_count: number };

// Nút Theo dõi kèm số người theo dõi.
//
// Server dựng trang KHÔNG có cookie của khách (bài 2.08), nên không biết khách đã theo dõi chưa:
// initial luôn "chưa theo dõi". Ở trình duyệt, nếu đã đăng nhập thì hỏi lại API (có cookie) để
// lấy trạng thái thật. initialDataUpdatedAt: 0 = coi dữ liệu ban đầu là cũ, tải lại ngay.
export function FollowButton({
  slug,
  initial,
  compact = false,
}: {
  slug: string;
  initial: FollowState;
  compact?: boolean;
}) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();
  const key = ["channel", slug, "follow"];

  const { data: state = initial } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<FollowState> => {
      const c = await api<ChannelDetail>(`/channels/${slug}`);
      return { following: c.following, followers_count: c.followers_count };
    },
    initialData: initial,
    initialDataUpdatedAt: 0,
    enabled: !!me,
  });

  const toggle = useMutation({
    mutationFn: (follow: boolean) =>
      api<FollowState>(`/channels/${slug}/follow`, { method: follow ? "POST" : "DELETE" }),
    // Cập nhật lạc quan (optimistic): đổi nút NGAY khi bấm, không chờ API. Lỗi thì trả lại như cũ.
    onMutate: async (follow) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<FollowState>(key);
      qc.setQueryData<FollowState>(key, (s = initial) => ({
        following: follow,
        followers_count: s.followers_count + (follow ? 1 : -1),
      }));
      return { prev };
    },
    onError: (_err, _follow, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: (s) => qc.setQueryData(key, s),
    // Danh sách "Kênh đang theo dõi" ở menu dọc đổi theo
    onSettled: () => qc.invalidateQueries({ queryKey: ["me", "following"] }),
  });

  const count = (
    <span className="text-sm text-ink-muted">
      {compactNumber(state.followers_count)} người theo dõi
    </span>
  );
  const button = !me ? (
    <Link
      href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
      className={buttonClass(false, compact)}
    >
      Theo dõi
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => toggle.mutate(!state.following)}
      aria-pressed={state.following}
      className={buttonClass(state.following, compact)}
    >
      {state.following ? "Đang theo dõi" : "Theo dõi"}
    </button>
  );

  if (compact) return button;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {button}
      {count}
    </div>
  );
}

function buttonClass(following: boolean, compact: boolean) {
  return cn(
    "inline-flex items-center justify-center rounded-full font-semibold transition",
    compact ? "h-9 px-4 text-sm" : "h-10 px-5",
    following ? "bg-surface-2 text-ink-2 hover:bg-surface-3" : "bg-ink text-white hover:bg-ink-2",
  );
}
```

- **Vì sao không tin `initial`**: trang kênh là server component, gọi API bằng `API_INTERNAL_URL` không
  kèm cookie (bài 2.08). Server luôn trả `following: false`. Ở trình duyệt, người đã đăng nhập hỏi lại
  API; `initialDataUpdatedAt: 0` báo TanStack Query "dữ liệu ban đầu đã cũ", nên tải lại ngay khi hiện.
- **`enabled: !!me`**: khách không gọi API vô ích; nút là link sang `/dang-nhap?next=<trang hiện tại>`,
  đăng nhập xong quay lại đúng trang.
- **Lạc quan**: `onMutate` đổi nút và số đếm ngay, giữ bản cũ trong `prev`; `onError` trả lại bản cũ;
  `onSuccess` lấy số thật từ API (đúng cả khi người khác vừa theo dõi cùng lúc).
- **`cancelQueries` trước khi sửa**: nếu truy vấn lấy trạng thái đang chạy dở, kết quả cũ của nó về sau
  sẽ ghi đè lên trạng thái vừa bấm.

### Bước 3: Trang kênh, `frontend/src/app/kenh/[slug]/page.tsx`

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { MediaGrid } from "@/components/category/MediaGrid";
import { FollowButton } from "@/components/channel/FollowButton";
import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { ApiError, api } from "@/lib/api";
import { getQueryClient } from "@/lib/query-client";
import { mediaListOptions } from "@/lib/queries";
import type { ChannelDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<ChannelDetail["type"], string> = {
  distributor: "Nhà phân phối nội dung",
  creator: "Nhà sáng tạo",
  business: "Doanh nghiệp",
  travel: "Doanh nghiệp lữ hành",
};

const getChannel = cache(async (slug: string) => {
  try {
    return await api<ChannelDetail>(`/channels/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getChannel((await params).slug);
  return { title: c.name, description: c.description };
}

// Trang kênh (mockup: kenh.html): ảnh bìa, thông tin, nút theo dõi, nội dung của kênh.
export default async function ChannelPage({ params }: Props) {
  const { slug } = await params;
  const queryClient = getQueryClient();
  const [channel] = await Promise.all([
    getChannel(slug),
    queryClient.prefetchInfiniteQuery(mediaListOptions({ channel: slug, sort: "new" })),
  ]);

  return (
    <div>
      {/* Ảnh bìa: chưa có ảnh thật cho kênh, dùng dải màu thương hiệu */}
      <div className="h-32 bg-gradient-brand md:h-48" />
      <div className="mx-auto max-w-[1680px] px-3 md:px-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end">
          {/* Chỉ avatar đè lên ảnh bìa (margin âm); chữ nằm dưới ảnh bìa cho dễ đọc */}
          <span className="-mt-10 w-fit shrink-0 rounded-full ring-4 ring-bg md:-mt-12">
            <Avatar name={channel.name} size="lg" />
          </span>
          <div className="min-w-0 flex-1 md:pt-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
              {channel.name}
              {channel.verified && (
                <span title="Kênh đã xác minh">
                  <Icon name="check" className="size-6 text-brand-600" />
                  <span className="sr-only">(đã xác minh)</span>
                </span>
              )}
            </h1>
            <p className="text-ink-muted">
              {TYPE_LABEL[channel.type]} · {channel.media_count} nội dung
            </p>
            <p className="mt-1 max-w-3xl text-ink-2">{channel.description}</p>
          </div>
          <FollowButton
            slug={channel.slug}
            initial={{ following: channel.following, followers_count: channel.followers_count }}
          />
        </header>

        <section className="mt-8 pb-6">
          <h2 className="mb-4 text-xl font-bold">Nội dung</h2>
          <HydrationBoundary state={dehydrate(queryClient)}>
            <MediaGrid channel={slug} sort="new" />
          </HydrationBoundary>
        </section>
      </div>
    </div>
  );
}
```

- **`cache(getChannel)`** của React: `generateMetadata` và trang cùng gọi, nhưng API chỉ bị gọi một lần.
- **Chỉ avatar có `-mt-10 md:-mt-12`** (đè lên ảnh bìa). Bản đầu kéo cả khối thông tin lên, tên kênh bị
  chữ đè lên ảnh bìa (xem "Hay gặp lỗi").
- **Prefetch + `HydrationBoundary`** như trang chuyên mục (bài 2.11): `MediaGrid` nhận
  `channel={slug}`, key giống hệt nên client dùng lại dữ liệu server đã lấy.

### Bước 4: Nối vào trang xem và thẻ media

`frontend/src/components/watch/WatchPage.tsx`: thay khối thông tin kênh và link "Theo dõi" tạm của Phần 02
bằng link tới trang kênh và `FollowButton`. Bản đầy đủ:

```tsx
import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { FollowButton } from "@/components/channel/FollowButton";
import { CommentSection } from "@/components/comment/CommentSection";
import { mediaHref, viewWord } from "@/components/media/links";
import { PlayerSlot } from "@/components/player/PlayerSlot";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard } from "@/lib/types";

import { getMedia } from "./get-media";

// Trang xem / nghe một media: trình phát, thông tin, kênh, mô tả, gợi ý bên phải.
export async function WatchPage({ category, slug }: { category: "xem" | "nghe"; slug: string }) {
  const media = await getMedia(slug);
  // /nghe/<slug-của-phim> → chuyển về đúng /xem/<slug> (308), để mỗi nội dung chỉ có một URL
  if (media.category !== category) permanentRedirect(mediaHref(media));

  const related = await api<MediaCard[]>(`/media/${encodeURIComponent(slug)}/related`);

  return (
    <div className="mx-auto grid max-w-[1680px] gap-6 px-3 py-4 md:px-6 md:py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        {media.youtube_id ? (
          <PlayerSlot
            media={{
              slug: media.slug,
              category: media.category,
              title: media.title,
              channel: media.channel.name,
              thumbnail: media.thumbnail_url,
              youtubeId: media.youtube_id,
            }}
          />
        ) : (
          <NoVideo thumbnail={media.thumbnail_url} />
        )}

        <h1 className="mt-4 text-xl font-bold md:text-2xl">{media.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)} ·{" "}
          <time dateTime={media.published_at}>{timeAgo(media.published_at)}</time> ·{" "}
          {media.group_label} · {media.genre_label}
          {durationLabel(media) && ` · ${durationLabel(media)}`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/kenh/${media.channel.slug}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <Avatar name={media.channel.name} />
            <span className="flex items-center gap-1 font-semibold hover:text-brand-700">
              {media.channel.name}
              {media.channel.verified && <Icon name="check" className="size-4 text-brand-600" />}
            </span>
          </Link>
          <FollowButton
            slug={media.channel.slug}
            initial={{ following: false, followers_count: media.channel.followers_count ?? 0 }}
          />
        </div>

        <div className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-4 text-[15px] leading-relaxed">
          {media.lineup_month && (
            <p className="mb-2 text-sm font-semibold text-accent-700">
              Line-up phim tháng {media.lineup_month.split("-").reverse().join("/")}
            </p>
          )}
          {media.description || "Chưa có mô tả."}
        </div>

        <CommentSection target={{ kind: "media", slug: media.slug }} />
      </div>

      <aside aria-label="Có thể bạn thích">
        <h2 className="mb-3 font-bold">Có thể bạn thích</h2>
        <ul className="grid gap-3">
          {related.map((m) => (
            <li key={m.id}>
              <RelatedItem media={m} />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function NoVideo({ thumbnail }: { thumbnail: string }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-overlay">
      <Image
        src={thumbnail}
        alt=""
        fill
        sizes="(min-width: 1024px) 60vw, 100vw"
        className="object-cover opacity-40"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white">
        <Icon name="screen" className="size-12 text-white/70" />
        <p className="mt-3 font-semibold">Nội dung này chưa có video</p>
        <p className="text-sm text-white/70">Video sẽ được cập nhật sớm.</p>
      </div>
    </div>
  );
}

function RelatedItem({ media }: { media: MediaCard }) {
  return (
    <Link href={mediaHref(media)} className="group flex gap-3">
      <span className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
        <Image src={media.thumbnail_url} alt="" fill sizes="160px" className="object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-semibold text-white">
          {durationLabel(media)}
        </span>
      </span>
      <span className="grid min-w-0 content-start">
        <strong className="line-clamp-2 text-sm leading-snug group-hover:text-brand-700">
          {media.title}
        </strong>
        <small className="mt-1 truncate text-ink-muted">{media.channel.name}</small>
        <small className="text-ink-muted">
          {compactNumber(media.view_count)} {viewWord(media)}
        </small>
      </span>
    </Link>
  );
}
```

(`CommentSection` ở cuối trang làm ở bài 5.07; tạm thời có thể bỏ hai dòng đó để chạy được.)

`frontend/src/components/media/MediaCard.tsx`: bọc tên kênh bằng link:

```tsx
            <Link href={`/kenh/${media.channel.slug}`} className="hover:text-ink">
              {media.channel.name}
            </Link>
```

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Chưa đăng nhập, mở http://localhost:3000/kenh/airlife | Ảnh bìa, avatar đè lên mép ảnh, "Nhà phân phối nội dung", lưới nội dung của kênh |
| Bấm "Theo dõi" | Sang trang đăng nhập; đăng nhập xong quay lại `/kenh/airlife` |
| Bấm "Theo dõi" khi đã đăng nhập | Nút đổi ngay thành "Đang theo dõi", số người theo dõi +1 |
| Tải lại trang (F5) | Vẫn "Đang theo dõi" (lấy lại từ API ở trình duyệt) |
| Mở http://localhost:3000/kenh/khong-co | Trang 404 |
| Bấm tên kênh trên một thẻ video | Sang trang kênh đó |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| F5 xong nút lại thành "Theo dõi" dù đã theo dõi | Chỉ dùng `initial` từ server; thiếu truy vấn lại ở trình duyệt hoặc thiếu `initialDataUpdatedAt: 0` |
| Tên kênh và chữ bị đè lên ảnh bìa | Đặt margin âm cho cả khối thông tin; chỉ avatar mới được kéo lên |
| Trang kênh B hiện nội dung của kênh A một lúc | `channel` chưa có trong `queryKey` |
