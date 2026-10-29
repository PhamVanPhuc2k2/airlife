import { cn } from "@/lib/cn";
import { ORDER_STATUS } from "@/lib/shop";
import type { OrderStatus as Status } from "@/lib/types";

export function OrderStatusBadge({ status }: { status: Status }) {
  const s = ORDER_STATUS[status];
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", s.tone)}>
      {s.label}
    </span>
  );
}
