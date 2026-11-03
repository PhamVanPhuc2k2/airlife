import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { OrdersAdmin, RefundsAdmin, UsersAdmin } from "@/components/admin/Commerce";
import { CommentsAdmin, ExperiencesAdmin, FeedbacksAdmin } from "@/components/admin/Moderation";
import { Overview } from "@/components/admin/Overview";
import { SurveysAdmin } from "@/components/admin/SurveysAdmin";
import { PageHead } from "@/components/ui/PageHead";
import { SECTIONS } from "@/lib/admin-sections";

type Props = { params: Promise<{ section: string }> };

// Khu quản trị không cho công cụ tìm kiếm lập chỉ mục
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  const s = SECTIONS.find((x) => x.key === section);
  return { title: `${s?.label ?? "Quản trị"} · Quản trị`, robots: { index: false, follow: false } };
}

// Toàn bộ dữ liệu quản trị lấy ở trình duyệt (cần cookie đăng nhập, không cache, không prefetch).
export default async function Page({ params }: Props) {
  const { section } = await params;
  if (!SECTIONS.some((s) => s.key === section)) notFound();
  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="radar"
        title="Quản trị"
        desc="Kiểm duyệt nội dung, xử lý đơn hàng, hoàn tiền và quản lý người dùng."
      />
      <AdminShell section={section}>
        {section === "tong-quan" && <Overview />}
        {section === "binh-luan" && <CommentsAdmin />}
        {section === "trai-nghiem" && <ExperiencesAdmin />}
        {section === "gop-y" && <FeedbacksAdmin />}
        {section === "khao-sat" && <SurveysAdmin />}
        {section === "don-hang" && <OrdersAdmin />}
        {section === "hoan-tien" && <RefundsAdmin />}
        {section === "nguoi-dung" && <UsersAdmin />}
      </AdminShell>
    </div>
  );
}
