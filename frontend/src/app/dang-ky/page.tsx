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
