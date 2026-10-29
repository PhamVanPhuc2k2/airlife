"use client";

import Image from "next/image";
import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { productHref } from "@/components/product/ProductCard";
import { useMe } from "@/lib/auth";
import { useCart, useCartActions } from "@/lib/cart";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { DELIVERY } from "@/lib/shop";
import type { CartLine } from "@/lib/types";

// Trang giỏ hàng: dùng chung cho khách và người đã đăng nhập (useCart lo phần khác nhau).
export function CartView() {
  const { me } = useMe();
  const { cart, isLoading } = useCart();

  if (isLoading || !cart) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (cart.lines.length === 0) {
    return (
      <div className="rounded-card bg-surface p-10 text-center shadow-sm ring-1 ring-ink/[0.07]">
        <Icon name="cart" className="mx-auto size-10 text-ink-dim" />
        <p className="mt-3 text-ink-muted">Giỏ hàng đang trống.</p>
        <Link href="/kinh-doanh" className="mt-4 inline-block font-semibold text-brand-700">
          Xem sản phẩm
        </Link>
      </div>
    );
  }

  const hasProblem = cart.lines.some((l) => l.problem);
  const noCommon = !hasProblem && cart.delivery_methods.length === 0;
  const checkoutHref = me ? "/thanh-toan" : `/dang-nhap?next=${encodeURIComponent("/thanh-toan")}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <ul className="divide-y divide-ink/[0.07] rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07]">
        {cart.lines.map((l) => (
          <CartRow key={l.variant_id} line={l} />
        ))}
      </ul>

      <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] lg:sticky lg:top-36">
        <h2 className="text-lg font-bold">Tóm tắt</h2>
        <p className="flex justify-between">
          <span className="text-ink-muted">Tạm tính ({cart.count} món)</span>
          <b>{formatPrice(cart.subtotal)}</b>
        </p>
        {cart.delivery_methods.length > 0 && (
          <p className="text-sm text-ink-muted">
            Nhận hàng: {cart.delivery_methods.map((m) => DELIVERY[m].label).join(", ")}
          </p>
        )}
        {hasProblem && (
          <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
            Có sản phẩm hết hàng hoặc ngừng bán. Bỏ hoặc giảm số lượng để đặt hàng.
          </p>
        )}
        {noCommon && (
          <p role="alert" className="rounded-card-sm bg-warning/15 p-3 text-sm text-accent-800">
            Các sản phẩm trong giỏ không có cách nhận hàng chung (ví dụ hàng miễn thuế chỉ nhận ở
            cửa ra máy bay). Hãy đặt thành nhiều đơn: bỏ bớt sản phẩm khỏi giỏ rồi đặt từng phần.
          </p>
        )}
        <Link
          href={checkoutHref}
          aria-disabled={!cart.ready}
          className={cn(
            "flex h-12 items-center justify-center rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110",
            !cart.ready && "pointer-events-none opacity-50",
          )}
        >
          {me ? "Đặt hàng" : "Đăng nhập để đặt hàng"}
        </Link>
        <p className="text-center text-xs text-ink-muted">Thanh toán khi nhận hàng</p>
      </aside>
    </div>
  );
}

const PROBLEM: Record<NonNullable<CartLine["problem"]>, string> = {
  unavailable: "Sản phẩm đã ngừng bán",
  out_of_stock: "Đã hết hàng",
  low_stock: "Không đủ hàng",
};

function CartRow({ line: l }: { line: CartLine }) {
  const cart = useCartActions();
  const max = Math.min(Math.max(l.stock, 1), 99);
  return (
    <li className="flex gap-4 p-4">
      <Link
        href={productHref(l.product)}
        className="relative size-20 shrink-0 overflow-hidden rounded-card-sm bg-surface-3 sm:size-24"
      >
        <Image
          src={l.product.image_url}
          alt=""
          fill
          loading="eager"
          sizes="96px"
          className="object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={productHref(l.product)}
          className="line-clamp-2 font-semibold hover:text-brand-700"
        >
          {l.product.name}
        </Link>
        <p className="text-sm text-ink-muted">
          {l.label} · {l.product.channel_name}
        </p>
        {l.problem && (
          <p className="text-sm font-semibold text-danger">
            {PROBLEM[l.problem]}
            {l.problem === "low_stock" && ` (còn ${l.stock})`}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center rounded-full ring-1 ring-ink/[0.14]">
            <button
              type="button"
              aria-label="Bớt một"
              disabled={l.quantity <= 1 || cart.pending}
              onClick={() => void cart.set(l.variant_id, l.quantity - 1)}
              className="flex size-9 items-center justify-center disabled:opacity-40"
            >
              <Icon name="minus" className="size-4" />
            </button>
            <span className="w-8 text-center font-semibold">{l.quantity}</span>
            <button
              type="button"
              aria-label="Thêm một"
              disabled={l.quantity >= max || cart.pending || !!l.problem}
              onClick={() => void cart.set(l.variant_id, l.quantity + 1)}
              className="flex size-9 items-center justify-center disabled:opacity-40"
            >
              <Icon name="plus" className="size-4" />
            </button>
          </div>
          <b className="text-accent-700">{formatPrice(l.price * l.quantity)}</b>
          <button
            type="button"
            onClick={() => void cart.remove(l.variant_id)}
            disabled={cart.pending}
            className="text-sm font-semibold text-ink-muted hover:text-danger"
          >
            Xoá
          </button>
        </div>
      </div>
    </li>
  );
}
