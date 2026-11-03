"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api";
import {
  type AdminOrder,
  type AdminOrderDetail,
  type AdminRefund,
  type AdminUser,
  useAdminAction,
  useAdminGet,
  useAdminList,
} from "@/lib/admin";
import { formatDate, formatPrice, timeAgo } from "@/lib/format";

import { Badge, ErrorNote, FilterBar, ListBox, Pager, RowButton } from "./kit";

const SIZE = 20;
const ORDER_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã huỷ",
};

export function OrdersAdmin() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useAdminList<AdminOrder>("orders", { status, q, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={status}
        statuses={[["", "Tất cả"], ...Object.entries(ORDER_LABEL)]}
        onStatus={(s) => {
          setStatus(s);
          setPage(1);
        }}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
      />
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((o) => (
          <li key={o.code} className="p-4">
            <button
              type="button"
              onClick={() => setOpen(open === o.code ? null : o.code)}
              aria-expanded={open === o.code}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-left"
            >
              <strong>{o.code}</strong>
              <span>{o.recipient_name}</span>
              <span className="text-ink-muted">{o.phone}</span>
              <Badge value={o.status} label={ORDER_LABEL[o.status]} />
              <span className="ml-auto font-semibold">{formatPrice(o.total)}</span>
              <time
                className="text-sm text-ink-muted"
                dateTime={o.created_at}
                suppressHydrationWarning
              >
                {timeAgo(o.created_at)}
              </time>
            </button>
            {open === o.code && <OrderDetail code={o.code} />}
          </li>
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

function OrderDetail({ code }: { code: string }) {
  const detail = useAdminGet<AdminOrderDetail>(`orders/${code}`);
  const move = useAdminAction(`orders/${code}/status`, "POST");
  const d = detail.data;
  if (!d) return <div className="mt-3 h-24 animate-pulse rounded-card-sm bg-surface-2" />;
  return (
    <div className="mt-3 space-y-3 rounded-card-sm bg-surface-2 p-4 text-sm">
      <p>
        Khách: <strong>{d.customer}</strong> ({d.email}) · Giao: {d.delivery_method}
        {d.flight_code &&
          ` · chuyến ${d.flight_code} ngày ${d.flight_date ? formatDate(d.flight_date) : ""}`}
        {d.address && ` · ${d.address}`}
      </p>
      {d.note && <p>Ghi chú: {d.note}</p>}
      <ul className="space-y-1">
        {d.items.map((it, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {it.product_name} · {it.variant_label} × {it.quantity}
            </span>
            <span>{formatPrice(it.line_total)}</span>
          </li>
        ))}
      </ul>
      <p className="text-right">
        Phí giao {formatPrice(d.shipping_fee)} · <strong>Tổng {formatPrice(d.total)}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {(d.next ?? []).map((to) => (
          <RowButton
            key={to}
            danger={to === "cancelled"}
            disabled={move.isPending}
            onClick={() => {
              if (to !== "cancelled" || window.confirm("Huỷ đơn và trả hàng về kho?"))
                move.mutate({ status: to });
            }}
          >
            → {ORDER_LABEL[to]}
          </RowButton>
        ))}
        {!d.next && <span className="text-ink-muted">Đơn đã kết thúc.</span>}
      </div>
      <ErrorNote error={move.error} />
    </div>
  );
}

export function RefundsAdmin() {
  const [filter, setFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const list = useAdminList<AdminRefund>("refunds", { filter, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={filter}
        statuses={[
          ["pending", "Cần hoàn"],
          ["done", "Đã hoàn"],
        ]}
        onStatus={(s) => {
          setFilter(s);
          setPage(1);
        }}
      />
      <p className="text-sm text-ink-muted">
        Hệ thống chưa tự hoàn tiền: hoàn qua cổng thanh toán hoặc chuyển khoản, rồi ghi lại mã giao
        dịch hoàn.
      </p>
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((r) => (
          <RefundRow key={r.code} r={r} />
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

function RefundRow({ r }: { r: AdminRefund }) {
  const [note, setNote] = useState("");
  const done = useAdminAction(`refunds/${r.code}/done`, "POST");
  const noteError = done.error instanceof ApiError ? done.error.fields?.note : undefined;
  return (
    <li className="space-y-2 p-4">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <strong>{r.code}</strong>
        <span className="font-semibold">{formatPrice(r.amount)}</span>
        <span>
          {r.customer} ({r.email})
        </span>
        <span className="text-ink-muted">
          {r.product_name} · {r.booking_code} · {r.booking_status}
        </span>
      </p>
      {r.reason && <p className="text-sm text-ink-muted">Lý do: {r.reason}</p>}
      {r.pending ? (
        <div className="flex flex-wrap items-start gap-2">
          <div className="grid gap-1">
            <input
              aria-label="Ghi chú hoàn tiền"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Mã giao dịch hoàn, VD: RF-9981"
              className="h-9 w-72 rounded-full px-4 text-sm ring-1 ring-ink/[0.14]"
            />
            {noteError && <p className="text-sm text-danger">{noteError}</p>}
          </div>
          <RowButton disabled={done.isPending} onClick={() => done.mutate({ note })}>
            Đã hoàn tiền
          </RowButton>
          {done.error && !noteError && <ErrorNote error={done.error} />}
        </div>
      ) : (
        <p className="text-sm text-success">
          Đã hoàn lúc {r.refunded_at ? formatDate(r.refunded_at) : ""}: {r.note}
        </p>
      )}
    </li>
  );
}

const ROLES = ["user", "creator", "business", "editor", "admin"];

export function UsersAdmin() {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminList<AdminUser>("users", { role, q, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={role}
        statuses={[["", "Mọi vai trò"], ...ROLES.map((r): [string, string] => [r, r])]}
        onStatus={(s) => {
          setRole(s);
          setPage(1);
        }}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
      />
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((u) => (
          <UserRow key={u.id} u={u} />
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

function UserRow({ u }: { u: AdminUser }) {
  const update = useAdminAction(`users/${u.id}`);
  const locked = u.status === "locked";
  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <strong>{u.display_name}</strong>
          <Badge value={u.status} label={locked ? "Bị khoá" : "Hoạt động"} />
          {!u.email_verified && <span className="text-xs text-warning">chưa xác minh email</span>}
        </p>
        <p className="text-sm text-ink-muted">
          {u.email} · tham gia {formatDate(u.created_at)}
        </p>
        <ErrorNote error={update.error} />
      </div>
      <select
        aria-label={`Vai trò của ${u.display_name}`}
        value={u.role}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ role: e.target.value, status: u.status })}
        className="h-9 rounded-full bg-surface px-3 ring-1 ring-ink/[0.14]"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <RowButton
        danger={!locked}
        disabled={update.isPending}
        onClick={() => {
          if (locked || window.confirm(`Khoá tài khoản ${u.email}? Họ bị đăng xuất ngay.`))
            update.mutate({ role: u.role, status: locked ? "active" : "locked" });
        }}
      >
        {locked ? "Mở khoá" : "Khoá"}
      </RowButton>
    </li>
  );
}
