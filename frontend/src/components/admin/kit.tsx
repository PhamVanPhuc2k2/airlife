"use client";

import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

// Bộ đồ nghề nhỏ dùng chung cho các trang quản trị.

export const STATUS_STYLE: Record<string, string> = {
  visible: "bg-success/10 text-success",
  active: "bg-success/10 text-success",
  open: "bg-success/10 text-success",
  completed: "bg-success/10 text-success",
  done: "bg-success/10 text-success",
  hidden: "bg-warning/15 text-warning",
  pending: "bg-warning/15 text-warning",
  new: "bg-warning/15 text-warning",
  closed: "bg-surface-2 text-ink-muted",
  confirmed: "bg-brand-50 text-brand-700",
  delivering: "bg-brand-50 text-brand-700",
  deleted: "bg-surface-2 text-ink-muted",
  cancelled: "bg-danger/10 text-danger",
  locked: "bg-danger/10 text-danger",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_STYLE[value] ?? "bg-surface-2 text-ink-muted",
      )}
    >
      {label ?? value}
    </span>
  );
}

// Thanh lọc: ô chọn trạng thái + ô tìm kiếm (không bắt buộc)
export function FilterBar({
  status,
  statuses,
  onStatus,
  q,
  onQ,
  children,
}: {
  status?: string;
  statuses?: [string, string][];
  onStatus?: (s: string) => void;
  q?: string;
  onQ?: (q: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {statuses && onStatus && (
        <select
          aria-label="Lọc theo trạng thái"
          value={status}
          onChange={(e) => onStatus(e.target.value)}
          className="h-10 rounded-full bg-surface px-4 ring-1 ring-ink/[0.14]"
        >
          {statuses.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
      {onQ && (
        <input
          type="search"
          aria-label="Tìm kiếm"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          maxLength={100}
          placeholder="Tìm…"
          className="h-10 w-56 rounded-full bg-surface px-4 ring-1 ring-ink/[0.14]"
        />
      )}
      {children}
    </div>
  );
}

export function Pager({
  page,
  size,
  total,
  onPage,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-muted">{total.toLocaleString("vi-VN")} mục</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="h-9 rounded-full px-4 ring-1 ring-ink/[0.14] disabled:opacity-40"
        >
          Trước
        </button>
        <span>
          {page}/{pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="h-9 rounded-full px-4 ring-1 ring-ink/[0.14] disabled:opacity-40"
        >
          Sau
        </button>
      </span>
    </nav>
  );
}

export function RowButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 shrink-0 rounded-full px-3 text-sm font-semibold ring-1 disabled:opacity-50",
        danger ? "text-danger ring-danger/40" : "text-brand-700 ring-brand-500/40",
      )}
    >
      {children}
    </button>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : "Có lỗi xảy ra, vui lòng thử lại";
  return (
    <p role="alert" className="rounded-card-sm bg-danger/10 px-4 py-2 text-sm text-danger">
      {msg}
    </p>
  );
}

// Khung danh sách: tải, rỗng, lỗi
export function ListBox({
  isPending,
  isError,
  empty,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (isPending) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;
  if (isError) return <ErrorNote error={new Error("x")} />;
  if (empty)
    return (
      <p className="rounded-card bg-surface p-6 text-center text-ink-muted ring-1 ring-ink/[0.07]">
        Không có mục nào.
      </p>
    );
  return (
    <ul className="divide-y divide-ink/[0.07] rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
      {children}
    </ul>
  );
}
