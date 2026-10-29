import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { SIDENAV, TOPNAV } from "@/config/nav";
import { SITE } from "@/config/site";

export function Footer() {
  return (
    <footer className="mt-6 border-t border-brand-500/35 bg-overlay px-6 pb-5 pt-11 text-sm text-white/65">
      <div className="mx-auto grid max-w-[1680px] gap-8 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr]">
        <div>
          <Link href="/" aria-label="Airlife – Trang chủ" className="inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu */}
            <img src="/brand/airlife-logo-white.svg" alt="Airlife" className="h-12 w-auto" />
          </Link>
          <p className="mt-3.5 max-w-[300px]">{SITE.tagline}.</p>
        </div>

        <FooterCol title="Chuyên mục">
          {TOPNAV.map((t) => (
            <FooterLink key={t.key} href={t.href}>
              {t.label}
            </FooterLink>
          ))}
        </FooterCol>

        <FooterCol title="Giải trí">
          {SIDENAV.slice(1, 4).map((t) => (
            <FooterLink key={t.key} href={t.href}>
              {t.label}
            </FooterLink>
          ))}
          <FooterLink href="/dang-ban">Mở gian hàng</FooterLink>
        </FooterCol>

        <FooterCol title="Liên hệ">
          <p className="flex gap-2.5">
            <Icon name="map" className="mt-px size-[18px] text-brand-300" />
            {SITE.address}
          </p>
          <a href={SITE.phoneHref} className="flex gap-2.5 hover:text-brand-200">
            <Icon name="phone" className="mt-px size-[18px] text-brand-300" />
            {SITE.phone}
          </a>
          <a href={`mailto:${SITE.email}`} className="flex gap-2.5 hover:text-brand-200">
            <Icon name="mail" className="mt-px size-[18px] text-brand-300" />
            {SITE.email}
          </a>
        </FooterCol>
      </div>

      <div className="mx-auto mt-8 max-w-[1680px] border-t border-white/10 pt-4 text-xs tracking-[0.06em] text-white/40">
        © {new Date().getFullYear()} AIRLIFE. All rights reserved.
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-brand-300">{title}</h2>
      {children}
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="hover:text-brand-200">
      {children}
    </Link>
  );
}
