"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { TabLinks } from "@/components/ui/TabLinks";
import { SECTIONS } from "@/lib/admin-sections";
import { useMe } from "@/lib/auth";

// Khung /admin: kiểm tra vai trò ở trình duyệt để ẩn menu và báo rõ vì sao không vào được.
// Đây CHỈ là tiện cho người dùng; chặn thật nằm ở API (RequireRole đọc vai trò từ database).
export function AdminShell({ section, children }: { section: string; children: React.ReactNode }) {
  const { me, isLoading } = useMe();
  const pathname = usePathname();
  const router = useRouter();

  // Biên tập viên không có trang tổng quan: đưa thẳng tới mục đầu tiên của họ
  const redirectEditor = section === "tong-quan" && me?.role === "editor";
  useEffect(() => {
    if (redirectEditor) router.replace("/admin/binh-luan");
  }, [redirectEditor, router]);

  if (isLoading || redirectEditor)
    return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (!me) {
    return (
      <p className="rounded-card bg-surface p-6 text-center ring-1 ring-ink/[0.07]">
        Đăng nhập bằng tài khoản quản trị để tiếp tục.{" "}
        <Link
          href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
          className="font-semibold text-brand-700"
        >
          Đăng nhập
        </Link>
      </p>
    );
  }
  const allowed = SECTIONS.filter((s) => (s.roles as readonly string[]).includes(me.role));
  const current = SECTIONS.find((s) => s.key === section);
  if (!allowed.length || !current || !(current.roles as readonly string[]).includes(me.role)) {
    return (
      <p role="alert" className="rounded-card bg-surface p-6 text-center ring-1 ring-ink/[0.07]">
        Tài khoản của bạn không có quyền vào mục này.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      <TabLinks
        label="Quản trị"
        items={allowed.map((s) => ({
          label: s.label,
          href: `/admin/${s.key}`,
          active: s.key === section,
        }))}
      />
      {children}
    </div>
  );
}
