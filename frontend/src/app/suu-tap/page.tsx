import type { Metadata } from "next";

import { FavoriteGrid } from "@/components/library/FavoriteGrid";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { PlaylistGrid } from "@/components/library/PlaylistGrid";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";

export const metadata: Metadata = { title: "Sưu tập", robots: { index: false } };

const TABS = [
  { key: "playlist", label: "Playlist" },
  { key: "da-luu", label: "Đã lưu" },
  { key: "yeu-thich", label: "Yêu thích" },
  { key: "da-xem", label: "Đã xem" },
] as const;

type Props = { searchParams: Promise<{ tab?: string }> };

// Sưu tập (mockup: renderCollection). Mỗi tab là một link ?tab=… (dán link là mở đúng tab).
// Trang chỉ dựng khung; danh sách là dữ liệu riêng nên client component lấy ở trình duyệt.
export default async function Page({ searchParams }: Props) {
  const { tab: raw } = await searchParams;
  const tab = TABS.find((t) => t.key === raw)?.key ?? "playlist";

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="library"
        title="Sưu tập"
        desc="Playlist của bạn, nội dung đã lưu để xem sau, sản phẩm và tour yêu thích, lịch sử xem."
      />
      <TabLinks
        label="Sưu tập"
        items={TABS.map((t) => ({
          label: t.label,
          href: t.key === "playlist" ? "/suu-tap" : `/suu-tap?tab=${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "playlist" && <PlaylistGrid />}
      {tab === "da-luu" && <LibraryGrid list="saved" />}
      {tab === "yeu-thich" && <FavoriteGrid />}
      {tab === "da-xem" && <LibraryGrid list="history" />}
    </div>
  );
}
