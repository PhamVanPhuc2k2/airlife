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
