# Bài 4.12: Frontend: xác minh email, quên và đặt lại mật khẩu; nghiệm thu Phần 04

> [← Bài trước](11-xac-minh-email-quen-mat-khau.md) · [Mục lục](../README.md)

## Mục tiêu

Trang `/xac-minh-email`, `/quen-mat-khau`, `/dat-lai-mat-khau`; link "Quên mật khẩu?" ở form đăng nhập;
nút "Gửi lại email xác minh" ở trang Bạn.

## Bạn sẽ học

- Hành động một lần (token) thì để người dùng **bấm**, đừng tự chạy khi mở trang.
- `useMutation` cho thao tác không cần form phức tạp.
- Thông báo thành công không để lộ thông tin.

## Viết code

### Bước 1: `frontend/src/components/auth/VerifyEmail.tsx`

```tsx
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
```

Vì sao bắt bấm nút: nhiều hệ thống lọc thư của công ty tự mở thử mọi link trong email để quét mã độc;
React StrictMode khi dev chạy `useEffect` **hai lần**. Tự gọi API lúc mở trang thì lần đầu đốt token, lần
sau báo "liên kết hết hạn", và người dùng thấy lỗi dù thật ra đã xác minh xong.

### Bước 2: `frontend/src/components/auth/ForgotPasswordForm.tsx`

```tsx
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
```

### Bước 3: `frontend/src/components/auth/ResetPasswordForm.tsx`

```tsx
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
```

Link hết hạn (`invalid_token`) thì có sẵn đường "Gửi lại liên kết" về trang quên mật khẩu.

### Bước 4: Ba trang

#### `frontend/src/app/xac-minh-email/page.tsx`

```tsx
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { VerifyEmail } from "@/components/auth/VerifyEmail";

export const metadata: Metadata = { title: "Xác minh email", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const token = (await searchParams).token;
  return (
    <AuthCard
      title="Xác minh email"
      desc="Bấm nút dưới đây để hoàn tất xác minh email cho tài khoản Airlife."
    >
      <VerifyEmail token={typeof token === "string" ? token : null} />
    </AuthCard>
  );
}
```

#### `frontend/src/app/quen-mat-khau/page.tsx`

```tsx
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Quên mật khẩu", robots: { index: false } };

export default function Page() {
  return (
    <AuthCard
      title="Quên mật khẩu"
      desc="Nhập email đã đăng ký, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
```

#### `frontend/src/app/dat-lai-mat-khau/page.tsx`

```tsx
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Đặt lại mật khẩu", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const token = (await searchParams).token;
  return (
    <AuthCard title="Đặt lại mật khẩu" desc="Nhập mật khẩu mới cho tài khoản Airlife của bạn.">
      <ResetPasswordForm token={typeof token === "string" ? token : null} />
    </AuthCard>
  );
}
```

### Bước 5: Link "Quên mật khẩu?" và nút gửi lại

`frontend/src/components/auth/LoginForm.tsx`, thêm ngay sau ô mật khẩu:

```tsx
      <Link
        href="/quen-mat-khau"
        className="-mt-2 justify-self-end text-sm font-semibold text-brand-700"
      >
        Quên mật khẩu?
      </Link>
```

`frontend/src/components/account/ProfileCard.tsx` có thêm `ResendVerify`. Bản đầy đủ:

```tsx
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
```

## Kiểm tra

Nghiệm thu Phần 04 trên trình duyệt, mở http://localhost:8025 ở một tab bên cạnh:

| Thao tác | Phải thấy |
|---|---|
| Đăng ký tài khoản mới | Trang Bạn: nhãn "Chưa xác minh email" và nút "Gửi lại email xác minh". Mailpit có thư "Xác minh email tài khoản Airlife" với nút tím |
| Bấm nút trong thư | Trang "Xác minh email" có nút, **chưa** xác minh khi chỉ mở trang |
| Bấm "Xác minh email" | "Email của bạn đã được xác minh." Trang Bạn hết nhãn |
| Mở lại link cũ, bấm | "Liên kết không hợp lệ hoặc đã hết hạn" |
| Đăng xuất, `/dang-nhap` → "Quên mật khẩu?", nhập email | "Nếu email này có tài khoản…"; Mailpit có thư "Đặt lại mật khẩu Airlife" |
| Nhập email không có tài khoản | Cùng câu thông báo; Mailpit **không** có thư mới |
| Mở link đặt lại, nhập mật khẩu mới | "Đã đặt mật khẩu mới… đăng xuất mọi thiết bị" |
| Mở lại link đó | "Liên kết không hợp lệ… Gửi lại liên kết" |
| Đăng nhập bằng mật khẩu mới | Thành công |

```bash
make fe-typecheck && make fe-lint && make fe-audit && make lint && make vuln
git add . && git commit -m "Frontend xác minh email, quên mật khẩu"
```

Đến đây xong Phần 04. Tiếp theo: [Phần 05 →](../05-kenh-va-binh-luan/01-schema-theo-doi-binh-luan.md)

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Mở link xác minh thì báo hết hạn ngay | Đang tự gọi API trong `useEffect` (StrictMode chạy hai lần) |
| Không thấy thư trong Mailpit | Worker không chạy (`make logs s=worker`), hoặc job đang chờ thử lại 30 giây |
| Link trong thư mở ra `localhost:3000` khi đã lên server | `APP_PUBLIC_URL` của server chưa đặt đúng domain |
