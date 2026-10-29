import { forwardRef, useId } from "react";

import { cn } from "@/lib/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

// Ô nhập có nhãn và dòng lỗi. forwardRef: react-hook-form cần ref của <input> để đọc giá trị
// và focus vào ô lỗi đầu tiên khi gửi form.
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        // aria-invalid + aria-describedby: trình đọc màn hình đọc luôn câu báo lỗi khi vào ô
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "h-11 rounded-card-sm bg-surface px-4 ring-1 ring-ink/[0.14] transition placeholder:text-ink-dim focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-0",
          error && "ring-danger",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
