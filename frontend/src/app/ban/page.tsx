import type { Metadata } from "next";

import { ProfileCard } from "@/components/account/ProfileCard";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn. Mockup còn có: chuyến bay sắp tới, đơn hàng, tiếp tục xem, kênh theo dõi; các
// khối đó thêm dần ở các phần sau khi có dữ liệu.
export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <ProfileCard />
    </div>
  );
}
