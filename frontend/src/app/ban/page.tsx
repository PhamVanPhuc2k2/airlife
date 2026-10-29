import type { Metadata } from "next";

import { ContinueWatching } from "@/components/account/ContinueWatching";
import { FollowingChannels } from "@/components/account/FollowingChannels";
import { LibraryStats } from "@/components/account/LibraryStats";
import { ProfileCard } from "@/components/account/ProfileCard";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn (mockup: renderMe). Mọi khối là dữ liệu riêng của người đang đăng nhập nên lấy ở
// trình duyệt (có cookie). Mockup còn có chuyến bay sắp tới (Phần 10) và đơn hàng (Phần 07).
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-3 py-6 md:px-6">
      <div className="space-y-3">
        <ProfileCard />
        <LibraryStats />
      </div>
      <ContinueWatching />
      <FollowingChannels />
    </div>
  );
}
