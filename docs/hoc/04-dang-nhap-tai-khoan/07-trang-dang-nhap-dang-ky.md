# Bài 4.07: Trang đăng nhập và đăng ký

> [← Bài trước](06-frontend-phien-dang-nhap.md) · [Mục lục](../README.md) · [Bài sau →](08-menu-tai-khoan-trang-ban.md)

## Mục tiêu

`/dang-nhap` và `/dang-ky`: form có kiểm tra ở trình duyệt, hiện lỗi của backend đúng ô, đăng nhập xong
quay lại trang trước.

## Bạn sẽ học

- `react-hook-form` + `zod`: form ít render lại, luật kiểm tra viết một lần, có kiểu TypeScript.
- Kiểm tra ở trình duyệt chỉ để **tiện**, kiểm tra ở backend mới để **an toàn**.
- `autocomplete` đúng chuẩn để trình quản lý mật khẩu hoạt động.
- Ô nhập dễ dùng với trình đọc màn hình.

## Viết code

### Bước 1: Cài thư viện

```bash
make npm c="install --save-exact react-hook-form@7.91.0 zod@4.6.7 @hookform/resolvers@6.0.2"
```

### Bước 2: `frontend/src/components/ui/Field.tsx`

```tsx
import { forwardRef, useId } from "react";

import { cn } from "@/lib/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

// Ô nhập có nhãn và dòng lỗi. forwardRef: react-hook-form cần ref của <input> để đọc giá trị
// và focus vào ô lỗi đầu tiên khi gửi form.
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        // aria-invalid + aria-describedby: trình đọc màn hình đọc luôn câu báo lỗi khi vào ô
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "h-11 rounded-card-sm bg-surface px-4 ring-1 ring-ink/[0.14] transition placeholder:text-ink-dim focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-0",
          error && "ring-danger",
          className,
        )}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
```

- **`useId()`**: id duy nhất để `<label htmlFor>` nối với `<input id>`. Bấm vào nhãn là focus vào ô;
  trình đọc màn hình đọc nhãn khi vào ô.
- **`aria-invalid`, `aria-describedby`**: trình đọc màn hình biết ô đang lỗi và đọc câu báo lỗi.

### Bước 3: `frontend/src/components/auth/AuthCard.tsx`

```tsx
import Link from "next/link";

// Khung chung của trang đăng nhập, đăng ký: logo, tiêu đề, form ở giữa.
export function AuthCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-10 md:py-16">
      <Link href="/" aria-label="Airlife – Trang chủ" className="mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
        <img src="/brand/airlife-logo.svg" alt="Airlife" className="h-16 w-auto" />
      </Link>
      <div className="mt-8 rounded-card bg-surface p-6 shadow-md ring-1 ring-ink/[0.07] md:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-ink-muted">{desc}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
```

### Bước 4: `frontend/src/components/auth/LoginForm.tsx`

```tsx
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
```

- **`noValidate`**: tắt kiểm tra có sẵn của trình duyệt (bong bóng "Please fill out this field" tiếng
  Anh), để zod hiện lỗi tiếng Việt thống nhất.
- **`autoComplete="current-password"`** (đăng nhập) và `"new-password"` (đăng ký): trình quản lý mật khẩu
  biết điền mật khẩu đã lưu, hay đề xuất mật khẩu mạnh.
- **`router.refresh()`**: server component nào phụ thuộc phiên thì được dựng lại.

### Bước 5: `frontend/src/components/auth/RegisterForm.tsx`

```tsx
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
```

- **`.refine(...)`**: luật liên quan nhiều ô (nhập lại mật khẩu phải khớp); `path: ["confirm"]` gắn lỗi
  vào ô "Nhập lại mật khẩu".
- **`setError(field, …)`** với `err.fields` của backend: "Email này đã được đăng ký" hiện ngay dưới ô email.
- Bản đầu viết `({ confirm: _confirm, ...values })` để bỏ ô `confirm`; lint báo biến không dùng. Sửa
  thành gửi rõ từng trường: đọc là biết gửi gì lên API.

### Bước 6: Trang

#### `frontend/src/app/dang-nhap/page.tsx`

```tsx
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Đăng nhập", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const next = (await searchParams).next;
  return (
    <AuthCard title="Đăng nhập" desc="Chào mừng bạn quay lại Airlife.">
      <LoginForm next={typeof next === "string" ? next : null} />
    </AuthCard>
  );
}
```

#### `frontend/src/app/dang-ky/page.tsx`

```tsx
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = { title: "Đăng ký", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const next = (await searchParams).next;
  return (
    <AuthCard
      title="Đăng ký"
      desc="Tạo tài khoản để theo dõi kênh, bình luận và lưu nội dung yêu thích."
    >
      <RegisterForm next={typeof next === "string" ? next : null} />
    </AuthCard>
  );
}
```

`robots: { index: false }`: trang đăng nhập không cần xuất hiện trên Google.

## Kiểm tra

- `/dang-ky`, bấm "Đăng ký" với form trống: 3 lỗi tiếng Việt dưới 3 ô.
- Đăng ký đúng: chuyển về trang chủ, góc phải có avatar chữ cái đầu.
- Đăng ký lại cùng email: lỗi "Email này đã được đăng ký" dưới ô email.
- `/dang-nhap`, sai mật khẩu: khung đỏ "Email hoặc mật khẩu không đúng".

```bash
make fe-typecheck && make fe-lint && make fe-audit
git add . && git commit -m "Trang đăng nhập, đăng ký"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Gõ vào ô mà form không nhận giá trị | `Field` thiếu `forwardRef`, react-hook-form không có ref của `<input>` |
| Lỗi backend không hiện dưới ô | Tên trường backend (`display_name`) khác tên trong form |
| Hiện bong bóng lỗi tiếng Anh | Thiếu `noValidate` trên `<form>` |
