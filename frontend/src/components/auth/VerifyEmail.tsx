"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { ApiError, api } from "@/lib/api";
import { meKey } from "@/lib/auth";

// Xác minh email: người dùng BẤM NÚT, không tự gửi khi mở trang. Token chỉ dùng được một lần, mà:
//   - Bộ lọc thư của nhiều công ty tự mở thử mọi link trong email để quét mã độc.
//   - React StrictMode (khi dev) chạy useEffect HAI lần.
// Tự gửi lúc mở trang thì token có thể bị "đốt" trước khi người dùng thật kịp thấy kết quả.
export function VerifyEmail({ token }: { token: string | null }) {
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () =>
      api<void>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    // Trạng thái email_verified đổi: tải lại /auth/me
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });

  if (!token) {
    return (
      <p className="text-danger">Liên kết thiếu mã xác minh. Hãy mở đúng liên kết trong email.</p>
    );
  }
  if (verify.isSuccess) {
    return (
      <div className="grid gap-4">
        <p className="rounded-card-sm bg-success/10 px-3 py-2 text-success">
          Email của bạn đã được xác minh.
        </p>
        <Link href="/ban" className="font-semibold text-brand-700">
          Về trang của bạn →
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {verify.error instanceof ApiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {verify.error.message}. Bạn có thể gửi lại email xác minh ở trang của bạn.
        </p>
      )}
      <button
        type="button"
        onClick={() => verify.mutate()}
        disabled={verify.isPending}
        className="h-11 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
      >
        {verify.isPending ? "Đang xác minh…" : "Xác minh email"}
      </button>
    </div>
  );
}
