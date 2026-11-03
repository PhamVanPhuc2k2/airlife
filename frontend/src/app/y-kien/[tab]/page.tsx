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
