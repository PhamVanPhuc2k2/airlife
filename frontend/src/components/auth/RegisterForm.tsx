"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError } from "@/lib/api";
import { safeNext, useRegister } from "@/lib/auth";

// Cùng luật với backend (internal/auth/service.go: validateRegister)
const schema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(2, "Tên hiển thị từ 2 đến 50 ký tự")
      .max(50, "Tên hiển thị từ 2 đến 50 ký tự"),
    email: z.string().trim().min(1, "Nhập email").email("Email không hợp lệ"),
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

export function RegisterForm({ next }: { next: string | null }) {
  const router = useRouter();
  const registerUser = useRegister();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      // Không gửi ô "nhập lại mật khẩu": chỉ để kiểm tra ở trình duyệt
      await registerUser.mutateAsync({
        display_name: v.display_name,
        email: v.email,
        password: v.password,
      });
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      // Backend trả lỗi theo từng trường ({"email": "Email này đã được đăng ký"}): gắn vào đúng ô
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    }
  });

  const apiError =
    registerUser.error instanceof ApiError && !registerUser.error.fields
      ? registerUser.error
      : null;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field
        label="Tên hiển thị"
        autoComplete="nickname"
        error={errors.display_name?.message}
        {...register("display_name")}
      />
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Field
        label="Mật khẩu"
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Field
        label="Nhập lại mật khẩu"
        type="password"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...register("confirm")}
      />
      {apiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {apiError.message}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="h-11 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
      >
        {isSubmitting ? "Đang tạo tài khoản…" : "Đăng ký"}
      </button>
      <p className="text-center text-sm text-ink-muted">
        Đã có tài khoản?{" "}
        <Link
          href={next ? `/dang-nhap?next=${encodeURIComponent(next)}` : "/dang-nhap"}
          className="font-semibold text-brand-700"
        >
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
