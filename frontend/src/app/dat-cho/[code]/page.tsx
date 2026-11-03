import type { Metadata } from "next";

import { BookingView } from "@/components/booking/BookingView";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tt?: string }>;
};

// Đơn đặt chỗ là dữ liệu riêng: BookingView lấy ở trình duyệt. proxy.ts chặn khách chưa đăng nhập.
export default async function Page({ params, searchParams }: Props) {
  const [{ code }, { tt }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <BookingView code={code} returned={tt === "1"} />
    </div>
  );
}
