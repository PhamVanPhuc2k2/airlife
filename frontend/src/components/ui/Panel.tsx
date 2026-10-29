import Link from "next/link";

import { Icon, type IconName } from "@/components/icons/Icon";

// Khung trắng có tiêu đề và link "Tất cả" (mockup: .panel).
export function Panel({
  title,
  icon,
  moreHref,
  children,
}: {
  title: string;
  icon?: IconName;
  moreHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-[18px] shadow-sm ring-1 ring-ink/[0.07]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {icon && <Icon name={icon} className="text-brand-600" />}
          {title}
        </h2>
        {moreHref && (
          <Link href={moreHref} className="text-sm font-semibold text-brand-700 hover:underline">
            Tất cả
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
