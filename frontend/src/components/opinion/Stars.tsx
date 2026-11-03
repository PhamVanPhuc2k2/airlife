import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";

// Hàng sao chỉ để xem (mockup: starRow)
export function Stars({ value }: { value: number }) {
  return (
    <span role="img" aria-label={`${value} trên 5 sao`} className="inline-flex text-warning">
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" className={cn("size-4", n <= value && "fill-current")} />
      ))}
    </span>
  );
}

// Chọn số sao: nhóm nút radio, dùng được bằng bàn phím
export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Số sao" className="inline-flex text-warning">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} sao`}
          onClick={() => onChange(n)}
          className="rounded p-0.5 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <Icon name="star" className={cn("size-6", n <= value && "fill-current")} />
        </button>
      ))}
    </div>
  );
}
