"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  email: z.string().trim().min(1, "Nhập email").email("Email không hợp lệ"),
});
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const forgot = useMutation({
    mutationFn: (v: Values) =>
      api<void>("/auth/forgot-password", { method: "POST", body: JSON.stringify(v) }),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (forgot.isSuccess) {
    // Cùng một câu dù email có tài khoản hay không (backend cũng vậy): không lộ email nào đã đăng ký
    return (
      <div className="grid gap-4">
        <p className="rounded-card-sm bg-success/10 px-3 py-2 text-success">
          Nếu email này có tài khoản Airlife, bạn sẽ nhận được thư hướng dẫn đặt lại mật khẩu trong
          vài phút. Liên kết có hiệu lực 30 phút.
        </p>
        <Link href="/dang-nhap" className="font-semibold text-brand-700">
          ← Quay lại đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit((v) => forgot.mutate(v))} noValidate className="grid gap-4">
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      {forgot.error instanceof ApiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {forgot.error.message}
        </p>
      )}
      <button
        type="submit"
        disabled={forgot.isPending}
        className="h-11 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
      >
        {forgot.isPending ? "Đang gửi…" : "Gửi hướng dẫn"}
      </button>
      <Link href="/dang-nhap" className="text-center text-sm font-semibold text-brand-700">
        ← Quay lại đăng nhập
      </Link>
    </form>
  );
}
