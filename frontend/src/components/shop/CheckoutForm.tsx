"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cartKey, useCart } from "@/lib/cart";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { DELIVERY, FREE_SHIPPING_FROM, HOME_SHIPPING_FEE } from "@/lib/shop";
import type { DeliveryMethod, Order } from "@/lib/types";

// Kiểm tra ở trình duyệt để báo lỗi nhanh; backend (internal/order: validate) kiểm tra lại hết.
// superRefine: luật phụ thuộc cách nhận hàng (cần số hiệu chuyến bay hay địa chỉ).
const schema = z
  .object({
    delivery_method: z.enum(["gate", "arrival", "home", "evoucher"], {
      message: "Chọn cách nhận hàng",
    }),
    recipient_name: z.string().trim().min(2, "Họ tên từ 2 ký tự").max(100),
    phone: z
      .string()
      .transform((s) => s.replace(/[\s.-]/g, ""))
      .pipe(z.string().regex(/^(0|\+84)[35789]\d{8}$/, "Số điện thoại Việt Nam không hợp lệ")),
    flight_code: z.string().trim().toUpperCase(),
    flight_date: z.string(),
    address: z.string().trim(),
    note: z.string().trim().max(500, "Tối đa 500 ký tự"),
  })
  .superRefine((v, ctx) => {
    if (v.delivery_method === "gate" || v.delivery_method === "arrival") {
      if (!/^[A-Z0-9]{2} ?\d{1,4}$/.test(v.flight_code)) {
        ctx.addIssue({
          code: "custom",
          path: ["flight_code"],
          message: "Số hiệu chuyến bay, VD: VN 220",
        });
      }
      if (!v.flight_date) {
        ctx.addIssue({ code: "custom", path: ["flight_date"], message: "Chọn ngày bay" });
      }
    }
    if (v.delivery_method === "home" && v.address.length < 10) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Nhập địa chỉ đầy đủ" });
    }
  });
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

function today(): string {
  // Ngày theo giờ máy của khách, dạng 2026-11-14 cho <input type="date">
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function CheckoutForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useMe();
  const { cart, isLoading } = useCart();
  // Khoá chống đặt trùng: sinh MỘT lần khi mở trang. Bấm "Đặt hàng" hai lần, hay mạng gửi lại,
  // đều mang cùng khoá nên server chỉ tạo một đơn (orders.idempotency_key).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      recipient_name: "",
      phone: "",
      flight_code: "",
      flight_date: "",
      address: "",
      note: "",
    },
  });
  // useWatch (không dùng watch()): chỉ component này vẽ lại khi đổi cách nhận hàng, và tương
  // thích React Compiler (watch() trả hàm không memo được, lint báo react-hooks/incompatible-library)
  const method = useWatch({ control, name: "delivery_method" }) as DeliveryMethod | undefined;

  // Điền sẵn tên và cách nhận hàng đầu tiên khi có dữ liệu
  useEffect(() => {
    if (me) setValue("recipient_name", me.display_name);
  }, [me, setValue]);
  const firstMethod = cart?.delivery_methods[0];
  useEffect(() => {
    if (firstMethod) setValue("delivery_method", firstMethod);
  }, [firstMethod, setValue]);

  const place = useMutation({
    mutationFn: (v: Output) =>
      api<Order>("/me/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(v),
      }),
    onSuccess: (order) => {
      // Giỏ đã được server xoá; đơn mới có trong danh sách
      void qc.invalidateQueries({ queryKey: cartKey });
      void qc.invalidateQueries({ queryKey: ["me", "orders"] });
      void qc.invalidateQueries({ queryKey: ["me", "stats"] });
      router.replace(`/don-hang/${order.code}?moi=1`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
      // Hết hàng / giỏ đổi: tải lại giỏ để hiện đúng tình trạng
      if (err instanceof ApiError && ["out_of_stock", "cart_changed"].includes(err.code)) {
        void qc.invalidateQueries({ queryKey: cartKey });
      }
    },
  });

  if (isLoading || !cart) return <div className="h-64 animate-pulse rounded-card bg-surface-2" />;
  if (cart.lines.length === 0 && !place.isSuccess) {
    return (
      <p className="py-16 text-center text-ink-muted">
        Giỏ hàng đang trống.{" "}
        <Link href="/kinh-doanh" className="font-semibold text-brand-700">
          Xem sản phẩm
        </Link>
      </p>
    );
  }

  const shipping = method === "home" && cart.subtotal < FREE_SHIPPING_FROM ? HOME_SHIPPING_FEE : 0;
  const apiError = place.error instanceof ApiError ? place.error : null;

  return (
    <form
      onSubmit={handleSubmit((v) => place.mutate(v))}
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"
    >
      <div className="space-y-6">
        <fieldset className="space-y-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <legend className="sr-only">Cách nhận hàng</legend>
          <h2 className="text-lg font-bold">Nhận hàng</h2>
          {cart.delivery_methods.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer gap-3 rounded-card-sm p-3 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                method === m
                  ? "bg-brand-50 ring-brand-600"
                  : "ring-ink/[0.14] hover:ring-brand-300",
              )}
            >
              <input
                type="radio"
                value={m}
                {...register("delivery_method")}
                className="mt-1 accent-brand-600"
              />
              <span>
                <b className="block font-semibold">{DELIVERY[m].label}</b>
                <span className="text-sm text-ink-muted">{DELIVERY[m].desc}</span>
              </span>
            </label>
          ))}
          {errors.delivery_method && (
            <p className="text-sm text-danger">{errors.delivery_method.message}</p>
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-2">
          <legend className="sr-only">Thông tin người nhận</legend>
          <h2 className="text-lg font-bold sm:col-span-2">Người nhận</h2>
          <Field
            label="Họ tên"
            autoComplete="name"
            error={errors.recipient_name?.message}
            {...register("recipient_name")}
          />
          <Field
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            error={errors.phone?.message}
            {...register("phone")}
          />
          {(method === "gate" || method === "arrival") && (
            <>
              <Field
                label="Số hiệu chuyến bay"
                placeholder="VN 220"
                autoCapitalize="characters"
                error={errors.flight_code?.message}
                {...register("flight_code")}
              />
              <Field
                label="Ngày bay"
                type="date"
                min={today()}
                error={errors.flight_date?.message}
                {...register("flight_date")}
              />
            </>
          )}
          {method === "home" && (
            <div className="sm:col-span-2">
              <Field
                label="Địa chỉ nhận hàng"
                autoComplete="street-address"
                placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"
                error={errors.address?.message}
                {...register("address")}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Field
              label="Ghi chú (không bắt buộc)"
              error={errors.note?.message}
              {...register("note")}
            />
          </div>
        </fieldset>
      </div>

      <aside className="space-y-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] lg:sticky lg:top-36">
        <h2 className="text-lg font-bold">Đơn hàng</h2>
        <ul className="space-y-3">
          {cart.lines.map((l) => (
            <li key={l.variant_id} className="flex gap-3 text-sm">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-card-sm bg-surface-3">
                <Image
                  src={l.product.image_url}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-semibold">{l.product.name}</span>
                <span className="text-ink-muted">
                  {l.label} × {l.quantity}
                </span>
              </span>
              <b>{formatPrice(l.price * l.quantity)}</b>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-ink/[0.07] pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Tạm tính</dt>
            <dd>{formatPrice(cart.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Phí giao hàng</dt>
            <dd>{shipping ? formatPrice(shipping) : "Miễn phí"}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>Tổng cộng</dt>
            <dd className="text-accent-700">{formatPrice(cart.subtotal + shipping)}</dd>
          </div>
        </dl>
        <p className="rounded-card-sm bg-surface-2 p-3 text-sm">
          <b>Thanh toán khi nhận hàng.</b> Thanh toán online (thẻ, ví điện tử) sắp ra mắt.
        </p>
        {apiError && (
          <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
            {apiError.message}
            {apiError.code === "email_not_verified" && (
              <>
                {" "}
                <Link href="/ban" className="font-semibold underline">
                  Xác minh email
                </Link>
              </>
            )}
            {["out_of_stock", "cart_changed", "no_common_delivery"].includes(apiError.code) && (
              <>
                {" "}
                <Link href="/gio-hang" className="font-semibold underline">
                  Về giỏ hàng
                </Link>
              </>
            )}
          </p>
        )}
        <button
          type="submit"
          disabled={place.isPending || place.isSuccess || !cart.ready}
          className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
        >
          {place.isPending
            ? "Đang đặt hàng…"
            : `Đặt hàng · ${formatPrice(cart.subtotal + shipping)}`}
        </button>
      </aside>
    </form>
  );
}
