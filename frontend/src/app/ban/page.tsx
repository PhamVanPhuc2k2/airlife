import type { Metadata } from "next";
import Link from "next/link";

import { ContinueWatching } from "@/components/account/ContinueWatching";
import { FollowingChannels } from "@/components/account/FollowingChannels";
import { LibraryStats } from "@/components/account/LibraryStats";
import { ProfileCard } from "@/components/account/ProfileCard";
import { OrderList } from "@/components/shop/OrderList";

export const metadata: Metadata = { title: "Bạn", robots: { index: false } };

// Trang Bạn (mockup: renderMe). Mọi khối là dữ liệu riêng của người đang đăng nhập nên lấy ở
// trình duyệt (có cookie). Mockup còn có chuyến bay sắp tới (Phần 10).
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-3 py-6 md:px-6">
      <div className="space-y-3">
        <ProfileCard />
        <LibraryStats />
      </div>
      <section aria-labelledby="don-hang">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="don-hang" className="text-xl font-bold">
            Đơn hàng của bạn
          </h2>
          <Link href="/don-hang" className="text-sm font-semibold text-brand-700">
            Xem tất cả
          </Link>
        </div>
        <OrderList limit={3} />
      </section>
      <ContinueWatching />
      <FollowingChannels />
    </div>
  );
}
