// Ghép class Tailwind, bỏ qua giá trị rỗng/false: cn("a", ok && "b", undefined) → "a b".
// Đủ dùng cho dự án; không cần thư viện clsx.
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
