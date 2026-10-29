import type { Metadata } from "next";

import { BookingView } from "@/components/booking/BookingView";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

type Props = { params: Promise<{ code: string }> };

// Đơn đặt chỗ là dữ liệu riêng: BookingView lấy ở trình duyệt. proxy.ts chặn khách chưa đăng nhập.
export default async function Page({ params }: Props) {
  const { code } = await params;
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <BookingView code={code} />
    </div>
  );
}
