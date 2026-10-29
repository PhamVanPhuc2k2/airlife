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
