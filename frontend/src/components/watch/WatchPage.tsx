import Image from "next/image";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { FollowButton } from "@/components/channel/FollowButton";
import { CommentSection } from "@/components/comment/CommentSection";
import { MediaActions } from "@/components/library/MediaActions";
import { ResumeNote } from "@/components/library/ResumeNote";
import { mediaHref, viewWord } from "@/components/media/links";
import { PlayerSlot } from "@/components/player/PlayerSlot";
import { ProductMiniList } from "@/components/product/ProductMiniList";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard, ProductCard } from "@/lib/types";

import { getMedia } from "./get-media";

// Trang xem / nghe một media: trình phát, thông tin, kênh, mô tả, gợi ý bên phải.
export async function WatchPage({ category, slug }: { category: "xem" | "nghe"; slug: string }) {
  const media = await getMedia(slug);
  // /nghe/<slug-của-phim> → chuyển về đúng /xem/<slug> (308), để mỗi nội dung chỉ có một URL
  if (media.category !== category) permanentRedirect(mediaHref(media));

  const [related, products] = await Promise.all([
    api<MediaCard[]>(`/media/${encodeURIComponent(slug)}/related`),
    api<ProductCard[]>(`/media/${encodeURIComponent(slug)}/products`),
  ]);

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
        {media.youtube_id && <ResumeNote slug={media.slug} />}

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
          <MediaActions slug={media.slug} title={media.title} />
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

      <aside aria-label="Có thể bạn thích" className="space-y-6">
        {/* Sản phẩm gắn trong video (mockup: "Sản phẩm trong video") */}
        {products.length > 0 && (
          <section className="rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]">
            <h2 className="mb-3 font-bold">Sản phẩm trong video</h2>
            <ProductMiniList items={products} />
          </section>
        )}
        <div>
          <h2 className="mb-3 font-bold">Có thể bạn thích</h2>
          <ul className="grid gap-3">
            {related.map((m) => (
              <li key={m.id}>
                <RelatedItem media={m} />
              </li>
            ))}
          </ul>
        </div>
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
