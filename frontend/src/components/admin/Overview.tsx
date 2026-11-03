"use client";

import Link from "next/link";

import { type AdminStats, type AuditEntry, useAdminGet } from "@/lib/admin";
import { compactNumber, formatPrice, timeAgo } from "@/lib/format";

import { Badge } from "./kit";

export function Overview() {
  const stats = useAdminGet<AdminStats>("stats");
  const audit = useAdminGet<AuditEntry[]>("audit");
  const s = stats.data;
  if (!s) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;

  // Việc cần làm trước, số liệu sau
  const todo: [string, number, string][] = [
    ["Khoản cần hoàn tiền", s.refunds_pending, "/admin/hoan-tien"],
    ["Đơn chờ xác nhận", s.orders_pending, "/admin/don-hang"],
    ["Góp ý mới", s.feedbacks_new, "/admin/gop-y"],
  ];
  const numbers: [string, string][] = [
    ["Người dùng", s.users_total.toLocaleString("vi-VN")],
    ["Mới 7 ngày", s.users_week.toLocaleString("vi-VN")],
    ["Đơn hàng", s.orders_total.toLocaleString("vi-VN")],
    ["Doanh thu đơn hoàn tất", formatPrice(s.orders_revenue)],
    ["Vé/tour đã xác nhận", s.bookings_confirmed.toLocaleString("vi-VN")],
    ["Tiền thanh toán online", formatPrice(s.payments_revenue)],
    ["Lượt xem", compactNumber(s.media_views)],
    ["Bình luận đang ẩn", s.comments_hidden.toLocaleString("vi-VN")],
  ];
  return (
    <div className="space-y-6">
      <section aria-label="Việc cần làm" className="grid gap-4 sm:grid-cols-3">
        {todo.map(([label, n, href]) => (
          <Link
            key={label}
            href={href}
            className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] hover:ring-brand-500"
          >
            <p className="text-3xl font-bold">{n}</p>
            <p className="text-ink-muted">{label}</p>
          </Link>
        ))}
      </section>
      <section aria-label="Số liệu" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {numbers.map(([label, v]) => (
          <div key={label} className="rounded-card bg-surface p-4 ring-1 ring-ink/[0.07]">
            <p className="text-xl font-bold">{v}</p>
            <p className="text-sm text-ink-muted">{label}</p>
          </div>
        ))}
      </section>
      <section
        aria-labelledby="nhat-ky"
        className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]"
      >
        <h2 id="nhat-ky" className="mb-3 text-lg font-bold">
          Thao tác gần đây
        </h2>
        <ul className="space-y-2 text-sm">
          {audit.data?.length === 0 && <li className="text-ink-muted">Chưa có thao tác nào.</li>}
          {audit.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <Badge value="confirmed" label={a.action} />
              <span>{a.actor}</span>
              <span className="text-ink-muted">
                {a.target_type} {a.target_id.slice(0, 13)}
              </span>
              <time
                className="ml-auto text-ink-muted"
                dateTime={a.created_at}
                suppressHydrationWarning
              >
                {timeAgo(a.created_at)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
