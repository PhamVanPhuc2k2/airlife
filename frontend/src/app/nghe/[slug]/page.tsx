import type { Metadata } from "next";

import { WatchPage } from "@/components/watch/WatchPage";
import { getMedia } from "@/components/watch/get-media";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Tiêu đề tab, mô tả và ảnh khi chia sẻ link lên Facebook/Zalo lấy theo từng media
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const media = await getMedia((await params).slug);
  return {
    title: media.title,
    description: media.description,
    openGraph: {
      title: media.title,
      description: media.description,
      images: [media.thumbnail_url],
    },
  };
}

export default async function Page({ params }: Props) {
  return <WatchPage category="nghe" slug={(await params).slug} />;
}
