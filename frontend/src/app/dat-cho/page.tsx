import type { Metadata } from "next";

import { BookingList } from "@/components/booking/BookingList";

export const metadata: Metadata = { title: "Đặt chỗ", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Vé và tour đã đặt</h1>
      <BookingList />
    </div>
  );
}
