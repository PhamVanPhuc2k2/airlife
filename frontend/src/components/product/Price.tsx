import { cn } from "@/lib/cn";
import { discountPercent, formatPrice } from "@/lib/format";

// Giá bán, giá cũ gạch ngang, nhãn % giảm (mockup: .price)
export function Price({
  price,
  oldPrice,
  prefix,
  size = "md",
}: {
  price: number;
  oldPrice: number | null;
  prefix?: string; // "Từ", "Giá/khách"
  size?: "md" | "lg";
}) {
  const off = discountPercent(price, oldPrice);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {prefix && <small className="text-sm text-ink-muted">{prefix}</small>}
      <strong className={cn("font-bold text-accent-700", size === "lg" ? "text-3xl" : "text-lg")}>
        {formatPrice(price)}
      </strong>
      {off > 0 && oldPrice && (
        <>
          <del className="text-sm text-ink-muted">{formatPrice(oldPrice)}</del>
          <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-xs font-bold text-danger">
            -{off}%
          </span>
        </>
      )}
    </p>
  );
}
