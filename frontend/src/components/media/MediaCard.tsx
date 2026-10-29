import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { compactNumber, durationLabel, timeAgo } from "@/lib/format";
import type { MediaCard as Media, Progress } from "@/lib/types";

import { mediaHref, viewWord } from "./links";

// Thẻ media trong lưới (trang chủ, chuyên mục). Ảnh 16:9, nhãn thời lượng góc dưới phải,
// avatar kênh + tiêu đề + "1,1 Tr lượt xem · 2 tuần trước" như mockup.
// progress (lịch sử xem): vạch đỏ ở đáy ảnh cho biết đã xem tới đâu. action: nút thêm ở góc
// phải (vd. "Bỏ khỏi lịch sử"), do nơi dùng truyền vào.
export function MediaCard({
  media,
  priority = false,
  progress,
  action,
}: {
  media: Media;
  priority?: boolean;
  progress?: Progress;
  action?: React.ReactNode;
}) {
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
          {progress && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/40">
              <span
                className="block h-full bg-danger"
                style={{
                  width: `${Math.min(100, (progress.position / progress.duration) * 100)}%`,
                }}
              />
            </span>
          )}
        </div>
      </Link>
      <div className="mt-3 flex gap-3">
        <Avatar name={media.channel.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link href={href} className="hover:text-brand-700">
              {media.title}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-muted">
            <Link href={`/kenh/${media.channel.slug}`} className="hover:text-ink">
              {media.channel.name}
            </Link>
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
        {action}
      </div>
    </article>
  );
}
