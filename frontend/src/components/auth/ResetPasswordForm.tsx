"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";

const schema = z
  .object({
    password: z
      .string()
      .min(8, "Mật khẩu cần ít nhất 8 ký tự")
      .max(128, "Mật khẩu tối đa 128 ký tự"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Mật khẩu nhập lại không khớp",
  });
type Values = z.infer<typeof schema>;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const reset = useMutation({
    mutationFn: (password: string) =>
      api<void>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (!token) {
    return (
      <p className="text-danger">
        Liên kết thiếu mã đặt lại mật khẩu. Hãy mở đúng liên kết trong email.
      </p>
    );
  }
  if (reset.isSuccess) {
    return (
      <div className="grid gap-4">
        <p className="rounded-card-sm bg-success/10 px-3 py-2 text-success">
          Đã đặt mật khẩu mới. Vì an toàn, mọi thiết bị đang đăng nhập đã được đăng xuất.
        </p>
        <Link
          href="/dang-nhap"
          className="flex h-11 items-center justify-center rounded-full bg-gradient-brand font-semibold text-white shadow-brand"
        >
          Đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((v) => reset.mutate(v.password))}
      noValidate
      className="grid gap-4"
    >
      <Field
        label="Mật khẩu mới"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Field
        label="Nhập lại mật khẩu mới"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      {reset.error instanceof ApiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {reset.error.fields?.password ?? reset.error.message}
          {reset.error.code === "invalid_token" && (
            <>
              {" "}
              <Link href="/quen-mat-khau" className="font-semibold underline">
                Gửi lại liên kết
              </Link>
            </>
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={reset.isPending}
        className="h-11 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
      >
        {reset.isPending ? "Đang lưu…" : "Đặt mật khẩu mới"}
      </button>
    </form>
  );
}
