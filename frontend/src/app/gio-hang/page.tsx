import type { Metadata } from "next";

import { CartView } from "@/components/shop/CartView";

export const metadata: Metadata = { title: "Giỏ hàng", robots: { index: false } };

// Giỏ hàng không cần đăng nhập (khách vẫn thêm được); bấm Đặt hàng mới phải đăng nhập.
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Giỏ hàng</h1>
      <CartView />
    </div>
  );
}
