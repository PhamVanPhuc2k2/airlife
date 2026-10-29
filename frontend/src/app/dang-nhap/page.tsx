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
