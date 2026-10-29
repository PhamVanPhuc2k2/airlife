import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { PlaylistView } from "@/components/library/PlaylistView";

export const metadata: Metadata = { title: "Playlist", robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

// Playlist là riêng tư: server không có cookie của khách nên không lấy được; PlaylistView lấy ở
// trình duyệt. proxy.ts đã chặn khách chưa đăng nhập (matcher /suu-tap/:path*).
export default async function Page({ params }: Props) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-[1680px] space-y-4 px-3 py-6 md:px-6">
      <Link
        href="/suu-tap"
        className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <Icon name="chevron" className="size-4 rotate-180" />
        Sưu tập
      </Link>
      <PlaylistView id={id} />
    </div>
  );
}
