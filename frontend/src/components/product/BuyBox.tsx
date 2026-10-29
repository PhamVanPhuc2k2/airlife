"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { ApiError } from "@/lib/api";
import { useCartActions } from "@/lib/cart";
import { cn } from "@/lib/cn";
import { DELIVERY } from "@/lib/shop";
import type { ProductDetail } from "@/lib/types";

import { FavoriteButton } from "./FavoriteButton";
import { Price } from "./Price";

// Khối mua hàng ở trang sản phẩm: chọn biến thể, số lượng, thêm vào giỏ / mua ngay.
export function BuyBox({ product: p }: { product: ProductDetail }) {
  const router = useRouter();
  const cart = useCartActions();
  // Mặc định chọn biến thể đầu tiên còn hàng
  const [variantId, setVariantId] = useState(
    () => (p.variants.find((v) => v.stock > 0) ?? p.variants[0])?.id,
  );
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");

  const variant = p.variants.find((v) => v.id === variantId);
  const maxQty = Math.min(variant?.stock ?? 0, 99);

  if (p.kind === "booking") {
    // Vé bay, tour: cần ngày đi, số khách, hạng dịch vụ; đặt chỗ làm ở Phần 08
    return (
      <div className="space-y-4">
        <Price
          price={p.price}
          oldPrice={p.old_price}
          prefix={p.tag === "ve-bay" ? "Giá/khách" : "Từ"}
          size="lg"
        />
        <p className="rounded-card-sm bg-surface-2 p-4 text-sm text-ink-2">
          Đặt vé, tour trực tuyến sắp ra mắt. Bạn có thể bấm yêu thích để lưu lại.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            disabled
            className="h-12 flex-1 rounded-full bg-ink font-semibold text-white opacity-50"
          >
            Đặt ngay
          </button>
          <FavoriteButton slug={p.slug} />
        </div>
      </div>
    );
  }

  const add = async (goToCart: boolean) => {
    if (!variant) return;
    setError("");
    try {
      await cart.add(variant.id, qty);
      if (goToCart) router.push("/gio-hang");
      else setAdded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thêm được vào giỏ, vui lòng thử lại");
    }
  };

  return (
    <div className="space-y-5">
      {variant && <Price price={variant.price} oldPrice={variant.old_price} size="lg" />}

      {p.variants.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Phân loại</legend>
          <div className="flex flex-wrap gap-2">
            {p.variants.map((v) => (
              <label
                key={v.id}
                className={cn(
                  "cursor-pointer rounded-card-sm px-4 py-2 text-sm font-semibold ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                  v.id === variantId
                    ? "bg-brand-50 text-brand-700 ring-brand-600"
                    : "ring-ink/[0.14] hover:ring-brand-300",
                  v.stock === 0 && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.id}
                  checked={v.id === variantId}
                  disabled={v.stock === 0}
                  onChange={() => {
                    setVariantId(v.id);
                    setQty(1);
                    setAdded(false);
                  }}
                  className="sr-only"
                />
                {v.label}
                {v.stock === 0 && " · Hết hàng"}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">Nhận hàng</p>
        <ul className="space-y-1.5 text-sm">
          {p.delivery_methods.map((m) => (
            <li key={m} className="flex gap-2">
              <Icon name="check" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>
                <b className="font-semibold">{DELIVERY[m].label}</b>
                <span className="text-ink-muted"> · {DELIVERY[m].desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {variant && variant.stock > 0 ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Số lượng</span>
          <div className="flex items-center rounded-full ring-1 ring-ink/[0.14]">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Bớt một"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Icon name="minus" className="size-4" />
            </button>
            <span className="w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              aria-label="Thêm một"
              className="flex size-10 items-center justify-center rounded-full disabled:opacity-40"
            >
              <Icon name="plus" className="size-4" />
            </button>
          </div>
          {variant.stock <= 10 && (
            <span className="text-sm text-accent-700">Chỉ còn {variant.stock}</span>
          )}
        </div>
      ) : (
        <p className="font-semibold text-danger">Sản phẩm tạm hết hàng</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void add(false)}
          disabled={!variant || variant.stock === 0 || cart.pending}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full font-semibold text-brand-700 ring-2 ring-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
        >
          <Icon name="cart" className="size-5" />
          Thêm vào giỏ
        </button>
        <button
          type="button"
          onClick={() => void add(true)}
          disabled={!variant || variant.stock === 0 || cart.pending}
          className="h-12 flex-1 rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-50"
        >
          Mua ngay
        </button>
        <FavoriteButton slug={p.slug} />
      </div>
      {added && (
        <p className="text-sm text-success" role="status">
          Đã thêm vào giỏ.{" "}
          <Link href="/gio-hang" className="font-semibold underline">
            Xem giỏ hàng
          </Link>
        </p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
