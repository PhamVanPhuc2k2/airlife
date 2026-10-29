"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { ApiError, api } from "@/lib/api";
import { useLogout, useMe } from "@/lib/auth";
import { formatDate } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  user: "Thành viên",
  creator: "Nhà sáng tạo",
  business: "Doanh nghiệp",
  editor: "Biên tập viên",
  admin: "Quản trị viên",
};

// Thẻ hồ sơ ở trang Bạn. Dữ liệu riêng của từng người nên lấy ở trình duyệt (useMe), không
// render sẵn trên server.
export function ProfileCard() {
  const { me, isLoading } = useMe();
  const logout = useLogout();
  const router = useRouter();

  // proxy.ts đã chặn khách chưa đăng nhập; tới đây mà không có me là phiên vừa hết hạn.
  // Chuyển trang là hiệu ứng phụ: đặt trong useEffect, không gọi ngay lúc render.
  const expired = !isLoading && !me;
  useEffect(() => {
    if (expired) router.replace("/dang-nhap?next=/ban");
  }, [expired, router]);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-card bg-surface-2" />;
  }
  if (!me) return null;

  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07] sm:flex-row sm:items-center">
      <Avatar name={me.display_name} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">{me.display_name}</h1>
        <p className="text-ink-muted">{me.email}</p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700">
            {ROLE_LABEL[me.role] ?? me.role}
          </span>
          {!me.email_verified && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 font-semibold text-accent-800">
              Chưa xác minh email
            </span>
          )}
          <span className="text-ink-muted">Tham gia {formatDate(me.created_at)}</span>
        </p>
      </div>
      {!me.email_verified && <ResendVerify />}
      <button
        type="button"
        onClick={() => logout.mutate(undefined, { onSettled: () => router.replace("/") })}
        className="h-10 self-start rounded-full bg-surface-2 px-5 font-semibold text-ink-2 hover:bg-surface-3 sm:self-center"
      >
        Đăng xuất
      </button>
    </section>
  );
}

// Gửi lại email xác minh (backend giới hạn 3 thư/giờ)
function ResendVerify() {
  const resend = useMutation({
    mutationFn: () => api<void>("/auth/verify-email/resend", { method: "POST" }),
  });
  if (resend.isSuccess) {
    return (
      <p className="text-sm text-success sm:max-w-[200px]">Đã gửi. Hãy kiểm tra hộp thư của bạn.</p>
    );
  }
  return (
    <div className="grid gap-1 self-start sm:self-center">
      <button
        type="button"
        onClick={() => resend.mutate()}
        disabled={resend.isPending}
        className="h-10 rounded-full bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {resend.isPending ? "Đang gửi…" : "Gửi lại email xác minh"}
      </button>
      {resend.error instanceof ApiError && (
        <p className="text-sm text-danger">{resend.error.message}</p>
      )}
    </div>
  );
}
