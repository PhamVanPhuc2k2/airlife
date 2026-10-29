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
