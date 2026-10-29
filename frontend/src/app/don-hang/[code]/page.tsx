import type { Metadata } from "next";

import { OrderView } from "@/components/shop/OrderView";

export const metadata: Metadata = { title: "Đơn hàng", robots: { index: false } };

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ moi?: string }>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ code }, { moi }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-6xl px-3 py-6 md:px-6">
      <OrderView code={code} justPlaced={moi === "1"} />
    </div>
  );
}
