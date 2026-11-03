"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { productHref } from "@/components/product/ProductCard";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatPrice } from "@/lib/format";
import { BOOKING_STATUS, shortDate } from "@/lib/shop";
import type { Booking } from "@/lib/types";

import { Countdown } from "./Countdown";
import { PassengerForm } from "./PassengerForm";

// Trang một đơn đặt chỗ: tóm tắt, đếm ngược giữ chỗ, form hành khách, thanh toán, huỷ.
//
// returned: khách vừa từ trang của cổng thanh toán quay về (?tt=1). Việc "khách quay về" và việc
// "cổng báo webhook về API" là hai đường riêng, đến theo thứ tự nào cũng được: khách có thể về
// trước khi webhook kịp tới. Vì vậy trang KHÔNG tin trình duyệt nói "đã trả"; nó hỏi lại API mỗi
// 2 giây (tối đa 45 giây) cho tới khi đơn đổi trạng thái.
export function BookingView({ code, returned }: { code: string; returned: boolean }) {
  const qc = useQueryClient();
  const key = ["me", "booking", code];
  // Còn đang đợi webhook không: bật khi vừa về từ cổng, tự tắt sau 45 giây. Không so Date.now()
  // lúc render (hàm không thuần: kết quả đổi theo thời gian, React Compiler không cho).
  const [waiting, setWaiting] = useState(returned);
  useEffect(() => {
    if (!returned) return;
    const id = window.setTimeout(() => setWaiting(false), 45_000);
    return () => window.clearTimeout(id);
  }, [returned]);
  const {
    data: b,
    isPending,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: key,
    queryFn: () => api<Booking>(`/me/bookings/${code}`),
    // Đang đợi webhook thì hỏi lại mỗi 2 giây cho tới khi đơn đổi trạng thái
    refetchInterval: (q) => (waiting && q.state.data?.status === "awaiting_payment" ? 2000 : false),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  });
  // Hết giờ thì tải lại đơn (thấy "Hết hạn giữ chỗ"). Key viết thẳng trong hàm để không phụ
  // thuộc mảng `key` (mảng mới mỗi lần render làm useCallback vô tác dụng).
  const refresh = useCallback(
    () => void qc.invalidateQueries({ queryKey: ["me", "booking", code] }),
    [qc, code],
  );
  const cancel = useMutation({
    mutationFn: () => api<Booking>(`/me/bookings/${code}/cancel`, { method: "POST" }),
    onSuccess: (booking) => {
      qc.setQueryData(key, booking);
      void qc.invalidateQueries({ queryKey: ["me", "bookings"] });
    },
  });

  const pay = useMutation({
    mutationFn: () => api<{ payment_url: string }>(`/me/bookings/${code}/pay`, { method: "POST" }),
    // Sang trang của cổng thanh toán (một trang khác hẳn, không phải route của ta): tải trang mới
    onSuccess: (r) => window.location.assign(r.payment_url),
  });

  if (isPending) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (error || !b) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Không tìm thấy đơn đặt chỗ này.{" "}
        <Link href="/dat-cho" className="font-semibold text-brand-700">
          Xem đơn của bạn
        </Link>
      </p>
    );
  }

  const active = b.status === "held" || b.status === "awaiting_payment";
  // Vừa về từ cổng, đơn vẫn chờ, chưa quá 45 giây: đang đợi webhook
  const confirming = waiting && b.status === "awaiting_payment" && b.payment?.status === "pending";
  const status = BOOKING_STATUS[b.status];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold md:text-3xl">Đặt chỗ #{b.code}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", status.tone)}>
          {status.label}
        </span>
      </header>

      {active && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning/10 p-4">
          <p className="text-sm">
            Chỗ của bạn được giữ trong thời gian bên cạnh.{" "}
            {b.status === "awaiting_payment"
              ? "Thanh toán trước khi hết giờ; quá giờ đơn tự huỷ và trả chỗ."
              : "Điền thông tin hành khách để tiếp tục."}
          </p>
          {/* key: mỗi lần tải lại đơn là một đồng hồ mới. Lỡ tải lại đúng lúc server vẫn báo
              còn hạn, đồng hồ mới đếm tiếp và gọi onExpire lần nữa thay vì đứng ở 00:00. */}
          <Countdown
            key={dataUpdatedAt}
            deadline={dataUpdatedAt + b.expires_in * 1000}
            onExpire={refresh}
          />
        </div>
      )}
      {b.status === "confirmed" && (
        <div role="status" className="flex gap-3 rounded-card bg-success/10 p-5">
          <Icon name="check" className="mt-0.5 size-6 shrink-0 text-success" />
          <p>
            <b className="block text-lg">Đã thanh toán, đặt chỗ được xác nhận!</b>
            Airlife đã gửi email xác nhận tới {b.contact?.email}.
          </p>
        </div>
      )}
      {confirming && (
        <p role="status" className="rounded-card bg-brand-50 p-4 text-brand-800">
          Đang xác nhận thanh toán với cổng… Bạn không cần làm gì thêm, trang sẽ tự cập nhật.
        </p>
      )}
      {b.status === "awaiting_payment" && !confirming && b.payment?.status === "failed" && (
        <p role="alert" className="rounded-card bg-danger/10 p-4 text-danger">
          Thanh toán chưa thành công. Bạn chưa bị trừ tiền; hãy thử lại trước khi hết giờ giữ chỗ.
        </p>
      )}
      {returned &&
        !confirming &&
        b.status === "awaiting_payment" &&
        b.payment?.status === "pending" && (
          <p role="alert" className="rounded-card bg-warning/10 p-4">
            Chưa nhận được kết quả thanh toán. Nếu bạn đã trả tiền, đơn sẽ tự xác nhận trong ít phút
            (hoặc liên hệ Airlife với mã {b.code}).
          </p>
        )}
      {b.payment?.refund_required && (
        <p role="alert" className="rounded-card bg-warning/10 p-4">
          Airlife đã nhận khoản thanh toán nhưng không thể xác nhận đặt chỗ này (hết chỗ, đã huỷ
          hoặc trả trùng). Khoản tiền sẽ được hoàn lại cho bạn; liên hệ Airlife với mã {b.code} nếu
          cần hỗ trợ.
        </p>
      )}
      {b.status === "expired" && !b.payment?.refund_required && (
        <p className="rounded-card bg-surface-2 p-4">
          Đã hết thời gian giữ chỗ.{" "}
          <Link href={productHref(b.product)} className="font-semibold text-brand-700">
            Đặt lại
          </Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-6">
          {active ? (
            <PassengerForm booking={b} />
          ) : (
            b.passengers.length > 0 && (
              <section className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
                <h2 className="mb-3 text-lg font-bold">Hành khách</h2>
                <ul className="space-y-1">
                  {b.passengers.map((p, i) => (
                    <li key={i}>
                      {p.full_name} · {formatDate(p.birth_date)} ·{" "}
                      {p.kind === "adult" ? "Người lớn" : "Trẻ em"}
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </div>

        <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <Link href={productHref(b.product)} className="flex gap-3">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
              <Image
                src={b.product.image_url}
                alt=""
                fill
                loading="eager"
                sizes="64px"
                className="object-cover"
              />
            </span>
            <span className="font-semibold hover:text-brand-700">{b.product.name}</span>
          </Link>
          <dl className="space-y-2 text-sm">
            <Row label="Hạng">{b.fare_label}</Row>
            <Row label={b.product.tag === "ve-bay" ? "Ngày bay" : "Khởi hành"}>
              {shortDate(b.depart_date)}
            </Row>
            {b.return_date && <Row label="Ngày về">{shortDate(b.return_date)}</Row>}
            <Row label={`Người lớn × ${b.adults}`}>{formatPrice(b.adult_price * b.adults)}</Row>
            {b.children > 0 && (
              <Row label={`Trẻ em × ${b.children}`}>{formatPrice(b.child_price * b.children)}</Row>
            )}
            <div className="flex justify-between border-t border-ink/[0.07] pt-2 text-base font-bold">
              <dt>Tổng cộng</dt>
              <dd className="text-accent-700">{formatPrice(b.total)}</dd>
            </div>
          </dl>
          {b.status === "awaiting_payment" && (
            <>
              <button
                type="button"
                onClick={() => pay.mutate()}
                disabled={pay.isPending || confirming}
                className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
              >
                {pay.isPending ? "Đang chuyển sang cổng…" : `Thanh toán ${formatPrice(b.total)}`}
              </button>
              {pay.error instanceof ApiError && (
                <p role="alert" className="text-sm text-danger">
                  {pay.error.message}
                </p>
              )}
            </>
          )}
          {active && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Huỷ đơn và trả lại chỗ?")) cancel.mutate();
              }}
              disabled={cancel.isPending}
              className="h-10 w-full rounded-full bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 hover:text-danger"
            >
              Huỷ giữ chỗ
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
