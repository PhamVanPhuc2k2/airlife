"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { ApiError, api } from "@/lib/api";
import { formatPrice } from "@/lib/format";

type Session = {
  txn: string;
  description: string;
  amount: number;
  status: "pending" | "succeeded" | "failed";
  return_url: string;
};

// Trang của cổng thanh toán GIẢ LẬP: thay cho trang VNPay/MoMo khi chưa có tài khoản cổng thật.
// Nó chỉ tồn tại ở dev: API không đăng ký các route /dev/fake-gateway ở production. Cổng thật là
// trang của họ, nằm ở tên miền khác; ta chỉ chuyển khách tới đó và đón khách quay về.
export function FakeGateway({ txn }: { txn: string }) {
  const {
    data: s,
    isPending,
    error,
  } = useQuery({
    queryKey: ["fake-gateway", txn],
    queryFn: () => api<Session>(`/dev/fake-gateway/${txn}`),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: (result: "succeeded" | "failed") =>
      api<{ return_url: string }>(`/dev/fake-gateway/${txn}`, {
        method: "POST",
        body: JSON.stringify({ result }),
      }),
    onSuccess: (r) => window.location.assign(r.return_url),
  });

  if (isPending)
    return <div className="mx-auto h-64 max-w-md animate-pulse rounded-card bg-surface-2" />;
  if (error instanceof ApiError || !s) {
    return (
      <p className="mx-auto max-w-md rounded-card bg-surface p-6 text-center text-ink-muted shadow-sm">
        Không có phiên thanh toán này (cổng giả lập chỉ chạy khi phát triển).
      </p>
    );
  }
  const settled = s.status !== "pending";
  return (
    <div className="mx-auto max-w-md space-y-5 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07]">
      <p className="rounded-card-sm bg-warning/15 px-3 py-2 text-center text-sm font-semibold text-accent-800">
        CỔNG THANH TOÁN GIẢ LẬP · chỉ dùng khi phát triển
      </p>
      <div className="text-center">
        <p className="text-sm text-ink-muted">{s.description}</p>
        <p className="mt-1 text-3xl font-bold text-accent-700">{formatPrice(s.amount)}</p>
      </div>
      {settled ? (
        <p className="text-center text-ink-muted">
          Phiên này đã {s.status === "succeeded" ? "thanh toán" : "kết thúc"}.{" "}
          <a href={s.return_url} className="font-semibold text-brand-700">
            Quay lại Airlife
          </a>
        </p>
      ) : (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => complete.mutate("succeeded")}
            disabled={complete.isPending}
            className="h-12 rounded-full bg-success font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            Thanh toán thành công
          </button>
          <button
            type="button"
            onClick={() => complete.mutate("failed")}
            disabled={complete.isPending}
            className="h-12 rounded-full bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 disabled:opacity-60"
          >
            Thanh toán thất bại
          </button>
          {/* Quay lại mà không trả: bỏ ?tt=1 (đó là dấu "vừa trả xong, đang đợi webhook") */}
          <a
            href={s.return_url.split("?")[0]}
            className="text-center text-sm font-semibold text-ink-muted hover:text-ink"
          >
            Quay lại Airlife, chưa thanh toán
          </a>
        </div>
      )}
      {complete.error instanceof ApiError && (
        <p role="alert" className="text-sm text-danger">
          {complete.error.message}
        </p>
      )}
    </div>
  );
}
