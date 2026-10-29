"use client";

import { Icon } from "@/components/icons/Icon";

// Nút xoá nhỏ ở góc thẻ media (bỏ khỏi lịch sử, bỏ lưu, bỏ khỏi playlist)
export function RemoveButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
    >
      <Icon name="trash" className="size-4" />
    </button>
  );
}
