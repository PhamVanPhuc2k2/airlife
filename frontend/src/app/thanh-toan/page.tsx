import type { Metadata } from "next";

import { CheckoutForm } from "@/components/shop/CheckoutForm";

export const metadata: Metadata = { title: "Thanh toán", robots: { index: false } };

// Cần đăng nhập (proxy.ts). Giỏ, thông tin người nhận là dữ liệu riêng: form lấy ở trình duyệt.
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Thanh toán</h1>
      <CheckoutForm />
    </div>
  );
}
