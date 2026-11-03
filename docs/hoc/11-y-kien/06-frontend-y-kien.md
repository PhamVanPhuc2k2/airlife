# Bài 11.06: Frontend trang Ý kiến

> [← Bài trước](05-thu-api.md) · [Mục lục](../README.md)

## Mục tiêu

Dựng trang `/y-kien` với ba tab (Trải nghiệm, Khảo sát, Góp ý) và khối khảo sát ở trang chủ.

## Bạn sẽ học

- Tab là **đường dẫn riêng** (`/y-kien/[tab]`), cùng cách với Tiện ích.
- Cập nhật "lạc quan" cho nút thích, và đồng bộ lại số thật từ server.
- Nhúng widget Turnstile (`@marsidev/react-turnstile`), lấy token, **reset sau mỗi lần gửi**.
- Đưa lỗi từng ô của API vào react-hook-form bằng `setError`.
- Chỉ hiện kết quả khảo sát sau khi đã bình chọn (như mockup).

## Viết code

Cài thư viện: `make npm c="install --save-exact @marsidev/react-turnstile@1.6.3"`.

### Bước 1: Kiểu dữ liệu và truy vấn

Thêm `Experience`, `Survey`… vào [frontend/src/lib/types.ts](../../../frontend/src/lib/types.ts) và `experiencesOptions` (phân trang vô hạn), `surveysOptions` vào [frontend/src/lib/queries.ts](../../../frontend/src/lib/queries.ts). Dữ liệu lấy ở **trình duyệt**, không prefetch ở server: mỗi người thấy khác nhau (đã thích, đã bình chọn).

### Bước 2: Trang, `frontend/src/app/y-kien/[tab]/page.tsx`

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExperienceFeed } from "@/components/opinion/ExperienceFeed";
import { FeedbackForm } from "@/components/opinion/FeedbackForm";
import { SurveyList } from "@/components/opinion/SurveyList";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";

const TABS = [
  { key: "trai-nghiem", label: "Trải nghiệm" },
  { key: "khao-sat", label: "Khảo sát" },
  { key: "gop-y", label: "Góp ý" },
] as const;

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  const t = TABS.find((x) => x.key === tab);
  return { title: t ? `${t.label} · Ý kiến` : "Ý kiến" };
}

// Ý kiến (mockup: renderOpinion). Dữ liệu mỗi người thấy khác nhau (đã thích, đã bình chọn) nên
// lấy ở trình duyệt, không prefetch ở server.
export default async function Page({ params }: Props) {
  const { tab } = await params;
  if (!TABS.some((t) => t.key === tab)) notFound();

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="chat"
        title="Ý kiến"
        desc="Chia sẻ trải nghiệm chuyến bay, tham gia khảo sát và góp ý để Airlife phục vụ bạn tốt hơn."
      />
      <TabLinks
        label="Ý kiến"
        items={TABS.map((t) => ({
          label: t.label,
          href: `/y-kien/${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "trai-nghiem" && <ExperienceFeed />}
      {tab === "khao-sat" && <SurveyList />}
      {tab === "gop-y" && <FeedbackForm />}
    </div>
  );
}
```

`/y-kien` chuyển hướng sang `/y-kien/trai-nghiem`; tab lạ trả `notFound()`. Menu "Ý kiến" ở thanh trên đã trỏ sẵn tới ba đường dẫn này.

### Bước 3: Trải nghiệm, `frontend/src/components/opinion/ExperienceFeed.tsx`

```tsx
"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { LoadMore } from "@/components/ui/LoadMore";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { experiencesOptions } from "@/lib/queries";
import type { Experience } from "@/lib/types";

import { StarPicker, Stars } from "./Stars";

// Tab "Trải nghiệm": ô đăng bài + dòng chảy bài chia sẻ, mới nhất trước.
export function ExperienceFeed() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
    useInfiniteQuery(experiencesOptions());
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <Composer />
      {isPending ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-2" />
      ) : items.length === 0 ? (
        <p className="text-ink-muted">Chưa có bài chia sẻ nào. Hãy là người đầu tiên!</p>
      ) : (
        <div className="space-y-4">
          {items.map((e) => (
            <Post key={e.id} e={e} />
          ))}
        </div>
      )}
      <LoadMore
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </div>
  );
}

function Composer() {
  const { me, isLoading } = useMe();
  const qc = useQueryClient();
  const [route, setRoute] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  const post = useMutation({
    mutationFn: () =>
      api<Experience>("/experiences", {
        method: "POST",
        body: JSON.stringify({ route, rating, body }),
      }),
    onSuccess: () => {
      setRoute("");
      setBody("");
      setRating(5);
      void qc.invalidateQueries({ queryKey: ["experiences"] });
    },
  });

  if (isLoading) return null;
  const box = "rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]";
  if (!me) {
    return (
      <p className={cn(box, "text-sm")}>
        <Link href="/dang-nhap?next=/y-kien/trai-nghiem" className="font-semibold text-brand-700">
          Đăng nhập
        </Link>{" "}
        để chia sẻ chuyến bay của bạn.
      </p>
    );
  }
  if (!me.email_verified) {
    return (
      <p className={cn(box, "text-sm")}>
        Bạn cần xác minh email trước khi đăng bài.{" "}
        <Link href="/ban" className="font-semibold text-brand-700">
          Gửi lại email xác minh
        </Link>
      </p>
    );
  }

  const fields = post.error instanceof ApiError ? post.error.fields : undefined;
  const message = post.error instanceof ApiError && !fields ? post.error.message : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        post.mutate();
      }}
      className={cn(box, "space-y-3")}
    >
      <div className="flex gap-3">
        <Avatar name={me.display_name} size="sm" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <label htmlFor="exp-body" className="sr-only">
            Chuyến bay vừa rồi của bạn thế nào?
          </label>
          <textarea
            id="exp-body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            placeholder="Chuyến bay vừa rồi của bạn thế nào?"
            aria-invalid={fields?.body ? true : undefined}
            className="w-full resize-y rounded-card-sm bg-surface-2 px-3 py-2 ring-1 ring-transparent focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {fields?.body && <p className="text-sm text-danger">{fields.body}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-3 pl-12">
        <div className="grid gap-1">
          <label htmlFor="exp-route" className="sr-only">
            Chặng bay
          </label>
          <input
            id="exp-route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            maxLength={40}
            placeholder="Chặng bay, VD: SGN → HAN"
            aria-invalid={fields?.route ? true : undefined}
            className="h-10 w-56 rounded-full bg-surface-2 px-4 ring-1 ring-transparent focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {fields?.route && <p className="text-sm text-danger">{fields.route}</p>}
        </div>
        <StarPicker value={rating} onChange={setRating} />
        <button
          type="submit"
          disabled={post.isPending}
          className="ml-auto h-10 rounded-full bg-gradient-brand px-6 font-semibold text-white shadow-brand disabled:opacity-60"
        >
          {post.isPending ? "Đang đăng…" : "Đăng"}
        </button>
      </div>
      {message && (
        <p role="alert" className="pl-12 text-sm text-danger">
          {message}
        </p>
      )}
    </form>
  );
}

function Post({ e }: { e: Experience }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(e.liked_by_me);
  const [likes, setLikes] = useState(e.like_count);

  const like = useMutation({
    mutationFn: (next: boolean) =>
      api<{ liked: boolean; like_count: number }>(`/experiences/${e.id}/like`, {
        method: next ? "POST" : "DELETE",
      }),
    // Lạc quan: đổi ngay, lỗi thì trả lại
    onMutate: (next) => {
      const prev = { liked, likes };
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
      return prev;
    },
    onError: (_err, _next, prev) => {
      if (prev) {
        setLiked(prev.liked);
        setLikes(prev.likes);
      }
    },
    onSuccess: (r) => {
      setLiked(r.liked);
      setLikes(r.like_count);
    },
  });

  const remove = useMutation({
    mutationFn: () => api<void>(`/experiences/${e.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["experiences"] }),
  });

  return (
    <article className="space-y-3 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]">
      <header className="flex items-center gap-3">
        <Avatar name={e.author.display_name} size="sm" />
        <div className="min-w-0 flex-1">
          <strong className="block truncate">{e.author.display_name}</strong>
          <time dateTime={e.created_at} className="text-xs text-ink-muted" suppressHydrationWarning>
            {timeAgo(e.created_at)}
          </time>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
          <Icon name="plane" className="size-4" />
          {e.route}
        </span>
      </header>
      <Stars value={e.rating} />
      {/* Hiện như văn bản (React tự escape), giữ xuống dòng người dùng gõ */}
      <p className="whitespace-pre-line break-words">{e.body}</p>
      <footer className="flex items-center gap-4 text-sm text-ink-muted">
        <button
          type="button"
          disabled={!me || like.isPending}
          onClick={() => like.mutate(!liked)}
          aria-pressed={liked}
          title={me ? undefined : "Đăng nhập để thích"}
          className={cn(
            "inline-flex items-center gap-1.5 font-semibold",
            liked ? "text-brand-700" : "hover:text-ink",
          )}
        >
          <Icon name="like" className={cn("size-4", liked && "fill-current")} />
          {likes}
        </button>
        {e.mine && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Xoá bài chia sẻ này?")) remove.mutate();
            }}
            disabled={remove.isPending}
            className="ml-auto inline-flex items-center gap-1.5 hover:text-danger"
          >
            <Icon name="trash" className="size-4" />
            Xoá
          </button>
        )}
      </footer>
    </article>
  );
}
```

- Khách thấy lời mời đăng nhập; tài khoản chưa xác minh thấy lời nhắc (backend cũng chặn, đây chỉ để người dùng hiểu vì sao).
- Nút thích **lạc quan**: đổi ngay, `onError` trả lại giá trị cũ, `onSuccess` lấy số thật từ server.

### Bước 4: Khảo sát, `frontend/src/components/opinion/SurveyList.tsx`

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { surveysOptions } from "@/lib/queries";
import type { Survey } from "@/lib/types";

// Tab "Khảo sát": mọi khảo sát đang mở / đã đóng kèm kết quả.
export function SurveyList() {
  const { data, isPending, isError } = useQuery(surveysOptions());
  if (isPending) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;
  if (isError) return <p className="text-ink-muted">Không tải được khảo sát, vui lòng thử lại.</p>;
  if (!data.length) return <p className="text-ink-muted">Chưa có khảo sát nào.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((s) => (
        <SurveyCard key={s.id} survey={s} />
      ))}
    </div>
  );
}

// Khối "Ý kiến" ở trang chủ: khảo sát đang mở đầu tiên. Chưa tải xong hoặc không có thì không hiện.
export function HomeSurvey() {
  const { data } = useQuery(surveysOptions());
  const first = data?.find((s) => s.open);
  if (!first) return null;
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Ý kiến</h2>
        <Link
          href="/y-kien/khao-sat"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Tham gia
        </Link>
      </div>
      <div className="max-w-xl">
        <SurveyCard survey={first} />
      </div>
    </section>
  );
}

export function SurveyCard({ survey: s }: { survey: Survey }) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();

  const vote = useMutation({
    mutationFn: (optionId: string) =>
      api<void>(`/surveys/${s.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ option_id: optionId }),
      }),
    // Thành công hay "đã bình chọn rồi" đều tải lại để thấy kết quả thật
    onSettled: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });

  const voted = s.my_option !== null;
  const canVote = s.open && !voted && !!me?.email_verified;
  const error = vote.error instanceof ApiError ? vote.error.message : null;

  return (
    <section className="space-y-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
      <h3 className="flex gap-2 font-bold">
        <Icon name="poll" className="mt-0.5 size-5 shrink-0 text-brand-600" />
        {s.question}
      </h3>
      <ul className="grid gap-2">
        {s.options.map((o) => {
          const picked = o.id === s.my_option;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={!canVote || vote.isPending}
                onClick={() => vote.mutate(o.id)}
                aria-pressed={picked}
                className={cn(
                  "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-card-sm px-4 py-2.5 text-left ring-1 ring-ink/[0.12]",
                  canVote && "hover:ring-brand-500",
                  picked && "ring-2 ring-brand-500",
                )}
              >
                {/* Thanh kết quả: chỉ hiện khi đã bình chọn hoặc khảo sát đã đóng */}
                {(voted || !s.open) && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0",
                      picked ? "bg-brand-100" : "bg-surface-2",
                    )}
                    style={{ width: `${o.percent}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  {picked && <Icon name="check" className="size-4 text-brand-700" />}
                  {o.label}
                </span>
                {(voted || !s.open) && <b className="relative">{o.percent}%</b>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-ink-muted">
        {s.total_votes.toLocaleString("vi-VN")} lượt bình chọn
        {!s.open && " · đã đóng"}
        {canVote && " · chọn một phương án để xem kết quả"}
      </p>
      {!me && s.open && (
        <p className="text-sm">
          <Link
            href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
            className="font-semibold text-brand-700"
          >
            Đăng nhập
          </Link>{" "}
          để bình chọn.
        </p>
      )}
      {me && !me.email_verified && s.open && !voted && (
        <p className="text-sm">
          Xác minh email để bình chọn.{" "}
          <Link href="/ban" className="font-semibold text-brand-700">
            Gửi lại email xác minh
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
```

`HomeSurvey` dùng lại `SurveyCard` cho khối "Ý kiến" ở trang chủ (`app/page.tsx`). Thanh phần trăm chỉ hiện khi `voted || !s.open`.

### Bước 5: Góp ý + Turnstile, `frontend/src/components/opinion/FeedbackForm.tsx`

```tsx
"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { FeedbackTopic } from "@/lib/types";

const TOPICS: [FeedbackTopic, string][] = [
  ["content", "Nội dung giải trí (phim, nhạc, podcast)"],
  ["shop", "Kinh doanh: vé bay, mua sắm, đơn hàng"],
  ["tour", "Tour bay"],
  ["utility", "Tiện ích: Flightradar, Wi-Fi, phòng chờ"],
  ["website", "Website / ứng dụng"],
  ["other", "Khác"],
];
const RATES = ["Rất tệ", "Chưa tốt", "Bình thường", "Tốt", "Tuyệt vời"];

type Values = {
  topic: FeedbackTopic;
  rating: string; // radio trả chuỗi; gửi lên đổi sang số
  body: string;
  flight_code: string;
  email: string;
};

// Khoá công khai của widget (không phải bí mật). Dev dùng khoá thử của Cloudflare.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Tab "Góp ý": khách chưa đăng nhập cũng gửi được, nên có Turnstile chặn bot.
export function FeedbackForm() {
  const { me } = useMe();
  const widget = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { topic: "content", rating: "4", body: "", flight_code: "", email: "" },
  });

  const send = useMutation({
    mutationFn: (v: Values) =>
      api<void>("/feedback", {
        method: "POST",
        headers: { "X-Turnstile-Token": token },
        body: JSON.stringify({
          ...v,
          rating: Number(v.rating),
          email: v.email || me?.email || "",
        }),
      }),
    onSuccess: () => {
      reset();
      setSent(true);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    },
    // Token chỉ dùng được MỘT lần, dù gửi thành công hay không: lấy token mới cho lần sau
    onSettled: () => {
      widget.current?.reset();
      setToken("");
    },
  });
  const formError =
    send.error instanceof ApiError && !send.error.fields ? send.error.message : null;

  if (sent) {
    return (
      <div
        role="status"
        className="max-w-2xl space-y-3 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07]"
      >
        <h2 className="text-lg font-bold">Cảm ơn góp ý của bạn!</h2>
        <p className="text-ink-muted">
          Airlife đã nhận được và sẽ phản hồi qua email nếu bạn để lại.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="font-semibold text-brand-700 hover:underline"
        >
          Gửi góp ý khác
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((v) => send.mutate(v))}
      noValidate
      className="grid max-w-2xl gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:p-6"
    >
      <h2 className="text-lg font-bold">Gửi góp ý cho Airlife</h2>

      <div className="grid gap-1.5">
        <label htmlFor="fb-topic" className="text-sm font-semibold">
          Bạn góp ý về
        </label>
        <select
          id="fb-topic"
          className="h-11 rounded-card-sm bg-surface px-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
          {...register("topic")}
        >
          {TOPICS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-semibold">Mức độ hài lòng</legend>
        <div className="grid grid-cols-5 gap-2">
          {RATES.map((label, i) => (
            <label key={label} className="cursor-pointer">
              <input
                type="radio"
                value={String(i + 1)}
                className="peer sr-only"
                {...register("rating")}
              />
              <span className="grid h-full place-items-center rounded-card-sm px-1 py-2 text-center ring-1 ring-ink/[0.14] peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-checked:ring-2 peer-checked:ring-brand-500 peer-focus-visible:outline-2 peer-focus-visible:outline-brand-500">
                <b>{i + 1}</b>
                <small className="text-[11px] leading-tight text-ink-muted">{label}</small>
              </span>
            </label>
          ))}
        </div>
        {errors.rating && <p className="text-sm text-danger">{errors.rating.message}</p>}
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="fb-body" className="text-sm font-semibold">
          Nội dung
        </label>
        <textarea
          id="fb-body"
          rows={5}
          maxLength={3000}
          placeholder="Điều gì khiến bạn hài lòng hoặc chưa hài lòng?"
          aria-invalid={errors.body ? true : undefined}
          className={cn(
            "rounded-card-sm bg-surface px-4 py-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500",
            errors.body && "ring-danger",
          )}
          {...register("body", {
            required: "Nhập nội dung góp ý",
            minLength: { value: 10, message: "Nội dung từ 10 ký tự trở lên" },
          })}
        />
        {errors.body && <p className="text-sm text-danger">{errors.body.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Số hiệu chuyến bay (nếu có)"
          placeholder="VD: VN 220"
          autoCapitalize="characters"
          error={errors.flight_code?.message}
          {...register("flight_code")}
        />
        <Field
          label="Email nhận phản hồi"
          type="email"
          placeholder={me?.email ?? "ban@email.com"}
          error={errors.email?.message}
          {...register("email")}
        />
      </div>

      <Turnstile
        ref={widget}
        siteKey={SITE_KEY}
        options={{ theme: "light", language: "vi" }}
        onSuccess={setToken}
        onExpire={() => setToken("")}
        onError={() => setToken("")}
      />

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={send.isPending || !token}
        className="h-12 rounded-full bg-gradient-brand px-8 font-semibold text-white shadow-brand disabled:opacity-60 sm:justify-self-start"
      >
        {send.isPending ? "Đang gửi…" : "Gửi góp ý"}
      </button>
    </form>
  );
}
```

- Nút gửi **khoá** cho đến khi có token (`disabled={!token}`).
- `onSettled` (chạy cả khi thành công lẫn lỗi) gọi `widget.current?.reset()` và xoá token: token chỉ dùng một lần.
- Khoá site đọc từ `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Trong `docker-compose.yml`:

```yaml
NEXT_PUBLIC_TURNSTILE_SITE_KEY: ${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}
```

Mặc định là khoá thử của Cloudflare. Production đặt `TURNSTILE_SITE_KEY` thật (khoá **site** công khai, khác khoá **secret** của API).

## Kiểm tra

```bash
make fe-lint && make fe-typecheck
```

Mở http://localhost:3000/y-kien. Thử: đăng bài (đủ ô, rồi bỏ trống để thấy lỗi từng ô), thích, xoá; bình chọn khảo sát (thanh phần trăm hiện, nút khoá); gửi góp ý (chờ widget ghi "Thành công!", gõ sai số hiệu để thấy lỗi từng ô, rồi gửi lại).

## Hay gặp lỗi

- **Widget Turnstile không hiện, nút gửi khoá mãi**: đổi biến môi trường trong `docker-compose.yml` mà chỉ `docker compose restart frontend` thì container **không** nạp lại biến. Dùng `docker compose up -d frontend` (tạo lại container).
- **Bấm gửi không có gì xảy ra, curl thì chạy**: CORS chưa cho header `X-Turnstile-Token` (bài 11.04).
- **Lần gửi thứ hai báo captcha_failed**: quên `reset()` widget sau lần gửi đầu.
- **`document.querySelector('iframe[src*=challenges.cloudflare.com]')` báo lỗi cú pháp** khi tự viết script thử: giá trị thuộc tính có dấu chấm phải đặt trong ngoặc kép. Ngoài ra iframe của Turnstile nằm trong shadow DOM nên truy vấn ngoài thường không thấy.
