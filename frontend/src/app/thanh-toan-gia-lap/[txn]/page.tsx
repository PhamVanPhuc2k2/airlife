import type { Metadata } from "next";

import { FakeGateway } from "@/components/booking/FakeGateway";

export const metadata: Metadata = { title: "Cổng thanh toán giả lập", robots: { index: false } };

type Props = { params: Promise<{ txn: string }> };

// Không nằm trong proxy.ts: cổng thật không có cookie đăng nhập của ta, trang này cũng vậy.
export default async function Page({ params }: Props) {
  const { txn } = await params;
  return (
    <div className="mx-auto max-w-3xl px-3 py-10">
      <FakeGateway txn={txn} />
    </div>
  );
}
