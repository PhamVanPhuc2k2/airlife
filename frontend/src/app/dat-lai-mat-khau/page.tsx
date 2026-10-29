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
