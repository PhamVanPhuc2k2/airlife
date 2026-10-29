"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError } from "@/lib/api";
import { safeNext, useLogin } from "@/lib/auth";

// zod: khai báo luật kiểm tra MỘT lần, vừa kiểm tra vừa suy ra kiểu TypeScript (z.infer).
// Kiểm tra ở trình duyệt chỉ để báo lỗi nhanh cho người dùng; backend vẫn kiểm tra lại tất cả,
// vì ai cũng gọi thẳng API được.
const schema = z.object({
  email: z.string().trim().min(1, "Nhập email").email("Email không hợp lệ"),
  password: z.string().min(1, "Nhập mật khẩu"),
});
type Values = z.infer<typeof schema>;

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const login = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      router.replace(safeNext(next));
      router.refresh(); // dựng lại server component có phụ thuộc phiên đăng nhập
    } catch {
      // Lỗi đã nằm trong login.error, hiện ở dưới
    }
  });

  const apiError = login.error instanceof ApiError ? login.error : null;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
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
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Link
        href="/quen-mat-khau"
        className="-mt-2 justify-self-end text-sm font-semibold text-brand-700"
      >
        Quên mật khẩu?
      </Link>
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
        {isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
      <p className="text-center text-sm text-ink-muted">
        Chưa có tài khoản?{" "}
        <Link
          href={next ? `/dang-ky?next=${encodeURIComponent(next)}` : "/dang-ky"}
          className="font-semibold text-brand-700"
        >
          Đăng ký
        </Link>
      </p>
    </form>
  );
}
