import type { Metadata } from "next";

import { OrderList } from "@/components/shop/OrderList";

export const metadata: Metadata = { title: "Đơn hàng", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Đơn hàng của bạn</h1>
      <OrderList />
    </div>
  );
}
