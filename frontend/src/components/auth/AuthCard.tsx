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
