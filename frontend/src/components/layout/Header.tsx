"use client";

import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { useUIStore } from "@/stores/ui-store";

import { AccountMenu } from "./AccountMenu";

export function Header() {
  const toggleNav = useUIStore((s) => s.toggleNav);

  return (
    <header className="fixed inset-x-0 top-0 z-[100] flex h-header items-center justify-between gap-2 bg-bg/90 px-2 backdrop-blur-md md:gap-4 md:px-4">
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className="icon-btn" aria-label="Mở menu" onClick={toggleNav}>
          <Icon name="menu" className="size-[22px]" />
        </button>
        <Link href="/" aria-label="Airlife – Trang chủ" className="ml-1 flex items-center">
          {/* Wordmark (không slogan): ở cỡ 32px slogan quá nhỏ, không đọc được */}
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu */}
          <img src="/brand/airlife-wordmark.svg" alt="Airlife" className="h-7 w-auto md:h-8" />
        </Link>
      </div>

      {/* Form GET thường: chạy được cả khi JavaScript chưa tải xong */}
      <form
        action="/tim-kiem"
        role="search"
        className="hidden h-[42px] max-w-[620px] flex-1 overflow-hidden rounded-full bg-surface shadow-[inset_0_0_0_1px_rgb(15_23_42/0.14)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_theme(colors.brand.500),0_0_0_4px_rgb(108_60_139/0.12)] md:flex"
      >
        <input
          type="search"
          name="q"
          placeholder="Tìm phim, podcast, vé bay, tour, kênh…"
          aria-label="Tìm kiếm"
          className="min-w-0 flex-1 bg-transparent px-5 outline-none placeholder:text-ink-dim focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <button
          type="submit"
          aria-label="Tìm"
          className="flex w-[60px] items-center justify-center bg-surface-2 text-ink-2 hover:text-brand-700"
        >
          <Icon name="search" />
        </button>
      </form>

      <div className="flex shrink-0 items-center gap-1">
        <Link href="/tim-kiem" className="icon-btn md:hidden" aria-label="Tìm kiếm">
          <Icon name="search" className="size-[22px]" />
        </Link>
        <Link
          href="/dang-ban"
          className="mr-1 hidden h-10 items-center gap-2 rounded-full px-3 font-semibold text-brand-700 transition-colors hover:bg-brand-50 md:inline-flex"
        >
          <Icon name="upload" />
          {/* Màn hẹp hơn 1280px chỉ còn icon, giống mockup */}
          <span className="hidden xl:inline">Đăng bán</span>
        </Link>
        <LangSwitch />
        <button type="button" className="icon-btn" aria-label="Thông báo">
          <Icon name="bell" className="size-[22px]" />
        </button>
        <Link href="/gio-hang" className="icon-btn" aria-label="Giỏ hàng">
          <Icon name="cart" className="size-[22px]" />
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}

// Chuyển ngôn ngữ như site cũ skyline.vn. Tiếng Anh làm ở bước i18n (TASKS.md 3.1),
// hiện chỉ hiển thị để giữ đúng bố cục.
function LangSwitch() {
  return (
    <div className="hidden rounded-full bg-surface-2 p-[3px] text-xs font-bold lg:flex">
      <span className="rounded-full bg-gradient-brand px-2.5 py-1 text-white" aria-current="true">
        VN
      </span>
      <span
        className="cursor-not-allowed rounded-full px-2.5 py-1 text-ink-muted"
        title="Tiếng Anh: sắp có"
        aria-disabled="true"
      >
        EN
      </span>
    </div>
  );
}
