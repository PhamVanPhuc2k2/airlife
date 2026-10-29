# Bài 7.09: Giỏ hàng: giỏ trong trình duyệt, gộp khi đăng nhập, trang Giỏ hàng

> [← Bài trước](08-trang-san-pham.md) · [Mục lục](../README.md) · [Bài sau →](10-thanh-toan-va-don-hang.md)

## Mục tiêu

- Khách chưa đăng nhập vẫn thêm vào giỏ được (lưu `localStorage` bằng Zustand `persist`).
- Đăng nhập thì giỏ trong trình duyệt được gộp vào giỏ trên server rồi xoá.
- Huy hiệu số món trên icon giỏ; trang `/gio-hang`.

## Bạn sẽ học

- Zustand `persist` và lỗi hydration khi đọc `localStorage` quá sớm (`skipHydration`).
- Một hook che đi hai nguồn dữ liệu khác nhau (`useCart`).
- `keepPreviousData`: đổi số lượng không làm giỏ nháy về "đang tải".
- Đây là chỗ đầu tiên dự án dùng Zustand cho dữ liệu được **lưu lại**; dữ liệu từ server vẫn ở TanStack Query.

## Viết code

### Bước 1: Store, `frontend/src/stores/cart-store.ts`

```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Giỏ hàng của khách CHƯA đăng nhập, lưu trong localStorage của trình duyệt.
//
// Chỉ lưu id biến thể và số lượng, không lưu tên hay giá: giá có thể đổi, nên mỗi lần hiện giỏ
// đều hỏi lại server (POST /cart/preview). Khách đăng nhập thì CartSync gộp giỏ này vào giỏ trên
// server rồi xoá đi.
//
// skipHydration: KHÔNG tự đọc localStorage lúc tạo store. Server không có localStorage nên lúc
// dựng HTML giỏ luôn rỗng; nếu trình duyệt đọc ngay lúc hydrate, lần render đầu sẽ khác HTML của
// server (huy hiệu "3" trên icon giỏ) và React báo lỗi hydration. CartSync gọi rehydrate() trong
// useEffect, tức SAU khi hydrate xong.
export type GuestItem = { variant_id: string; quantity: number };

type CartState = {
  items: GuestItem[];
  hydrated: boolean; // đã đọc xong localStorage chưa
  set: (variantId: string, quantity: number) => void;
  add: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
};

const MAX_QTY = 99;
const MAX_LINES = 50;

export const useGuestCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      hydrated: false,
      set: (variantId, quantity) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.variant_id === variantId ? { ...it, quantity: clamp(quantity) } : it,
          ),
        })),
      add: (variantId, quantity) =>
        set((s) => {
          const found = s.items.find((it) => it.variant_id === variantId);
          if (found) {
            return {
              items: s.items.map((it) =>
                it === found ? { ...it, quantity: clamp(it.quantity + quantity) } : it,
              ),
            };
          }
          if (s.items.length >= MAX_LINES) return s;
          return { items: [{ variant_id: variantId, quantity: clamp(quantity) }, ...s.items] };
        }),
      remove: (variantId) =>
        set((s) => ({ items: s.items.filter((it) => it.variant_id !== variantId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "airlife-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items }), // không lưu cờ hydrated
      skipHydration: true,
      onRehydrateStorage: () => () => useGuestCart.setState({ hydrated: true }),
    },
  ),
);

function clamp(q: number): number {
  return Math.min(Math.max(Math.round(q), 1), MAX_QTY);
}
```

- **Chỉ lưu id và số lượng**: tên, giá có thể đổi; hiện giỏ thì hỏi server (`POST /cart/preview`).
- **`skipHydration: true`**: mặc định `persist` đọc `localStorage` ngay khi tạo store, tức ngay lần render
  đầu ở trình duyệt. Server không có `localStorage` nên HTML server dựng có giỏ rỗng; trình duyệt render ra
  "3 món", khác HTML, React báo lỗi hydration. Tắt tự đọc, để `CartSync` gọi `rehydrate()` trong
  `useEffect` (chạy **sau** hydrate). Đây là cùng vấn đề "giá trị chỉ trình duyệt biết" với cookie phiên ở
  bài 4.06.
- **`partialize`**: chỉ lưu `items`, không lưu cờ `hydrated`.

### Bước 2: Hook, `frontend/src/lib/cart.ts`

```ts
"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useGuestCart } from "@/stores/cart-store";

import { api } from "./api";
import { useMe } from "./auth";
import type { Cart } from "./types";

// Giỏ hàng dùng chung cho hai trường hợp, component không cần biết đang ở trường hợp nào:
//   - Đã đăng nhập: giỏ trên server (GET /me/cart), sửa bằng PUT/DELETE /me/cart/items/…
//   - Khách: giỏ trong localStorage (stores/cart-store.ts), thông tin hiện tại lấy qua
//     POST /cart/preview.

export const cartKey = ["me", "cart"] as const;
const EMPTY: Cart = { lines: [], count: 0, subtotal: 0, delivery_methods: [], ready: false };

export function useCart(): { cart: Cart | undefined; isLoading: boolean } {
  const { me, isLoading: meLoading } = useMe();
  const items = useGuestCart((s) => s.items);
  const hydrated = useGuestCart((s) => s.hydrated);

  const server = useQuery({
    queryKey: cartKey,
    queryFn: () => api<Cart>("/me/cart"),
    enabled: !!me,
  });
  const guest = useQuery({
    // items nằm trong key: đổi số lượng là tự hỏi lại giá
    queryKey: ["cart", "preview", items],
    queryFn: () =>
      items.length === 0
        ? Promise.resolve(EMPTY)
        : api<Cart>("/cart/preview", { method: "POST", body: JSON.stringify({ items }) }),
    enabled: !meLoading && !me && hydrated,
    // Đổi số lượng: giữ giỏ cũ trên màn hình trong lúc chờ giỏ mới, không nháy về "đang tải"
    placeholderData: keepPreviousData,
  });

  if (me) return { cart: server.data, isLoading: server.isPending };
  return { cart: guest.data, isLoading: meLoading || !hydrated || guest.isPending };
}

// Thêm, đổi số lượng, bỏ một dòng. Trả Promise để nút "Mua ngay" chờ thêm xong mới chuyển trang.
export function useCartActions() {
  const { me } = useMe();
  const qc = useQueryClient();
  const guest = useGuestCart();

  const put = useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: string; quantity: number }) =>
      api<Cart>(`/me/cart/items/${variantId}`, {
        method: "PUT",
        body: JSON.stringify({ quantity }),
      }),
    onSuccess: (cart) => qc.setQueryData(cartKey, cart), // API trả giỏ mới: không cần tải lại
  });
  const del = useMutation({
    mutationFn: (variantId: string) =>
      api<Cart>(`/me/cart/items/${variantId}`, { method: "DELETE" }),
    onSuccess: (cart) => qc.setQueryData(cartKey, cart),
  });

  return {
    pending: put.isPending || del.isPending,
    error: put.error ?? del.error,
    async add(variantId: string, quantity: number) {
      if (!me) return guest.add(variantId, quantity);
      // Số lượng đang có trong giỏ (chưa có trong cache thì tải về)
      const current = await qc.ensureQueryData({
        queryKey: cartKey,
        queryFn: () => api<Cart>("/me/cart"),
      });
      const existing = current.lines.find((l) => l.variant_id === variantId)?.quantity ?? 0;
      await put.mutateAsync({ variantId, quantity: Math.min(existing + quantity, 99) });
    },
    async set(variantId: string, quantity: number) {
      if (!me) return guest.set(variantId, quantity);
      await put.mutateAsync({ variantId, quantity });
    },
    async remove(variantId: string) {
      if (!me) return guest.remove(variantId);
      await del.mutateAsync(variantId);
    },
  };
}

// Đặt một lần trong AppShell: đọc giỏ của khách từ localStorage sau khi hydrate, và gộp vào giỏ
// trên server ngay khi khách đăng nhập.
export function CartSync() {
  const { me } = useMe();
  const qc = useQueryClient();
  const items = useGuestCart((s) => s.items);
  const hydrated = useGuestCart((s) => s.hydrated);
  const merging = useRef(false);

  useEffect(() => {
    void useGuestCart.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!me || !hydrated || items.length === 0 || merging.current) return;
    merging.current = true;
    api<Cart>("/me/cart/merge", { method: "POST", body: JSON.stringify({ items }) })
      .then((cart) => {
        qc.setQueryData(cartKey, cart);
        useGuestCart.getState().clear();
      })
      .catch(() => {
        // Gộp lỗi thì giữ nguyên giỏ trong trình duyệt, lần tải trang sau thử lại
      })
      .finally(() => {
        merging.current = false;
      });
  }, [me, hydrated, items, qc]);

  return null;
}
```

- **`useCart`**: đã đăng nhập thì đọc `GET /me/cart`; khách thì đọc `POST /cart/preview` với `items` nằm
  trong `queryKey` (đổi số lượng là tự hỏi lại). Component dùng không cần biết đang ở trường hợp nào.
- **`useCartActions().add`**: API nhận số lượng **cuối cùng** của dòng, nên phải biết dòng đó đang có bao
  nhiêu. `ensureQueryData` trả dữ liệu trong cache, chưa có thì tải về.
- **`CartSync`**: đặt một lần trong `AppShell`. Thấy `me` (vừa đăng nhập) và giỏ trình duyệt có hàng thì gộp
  (`POST /me/cart/merge`), xong xoá giỏ trình duyệt. `merging` (ref) chặn gộp hai lần khi effect chạy lại
  trong lúc request đầu chưa xong; mà có gộp hai lần thì server lấy `GREATEST` (bài 7.02) nên vẫn đúng.

Thêm vào `frontend/src/components/layout/AppShell.tsx`: `import { CartSync } from "@/lib/cart";` và
`<CartSync />` ngay trước `<Header />`.

### Bước 3: Huy hiệu trên icon giỏ, `frontend/src/components/layout/Header.tsx`

Bản đầy đủ:

```tsx
"use client";

import Link from "next/link";

import { Icon } from "@/components/icons/Icon";
import { useCart } from "@/lib/cart";
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
        <CartButton />
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

// Icon giỏ hàng kèm huy hiệu số món
function CartButton() {
  const { cart } = useCart();
  const count = cart?.count ?? 0;
  return (
    <Link
      href="/gio-hang"
      className="icon-btn relative"
      aria-label={count ? `Giỏ hàng, ${count} sản phẩm` : "Giỏ hàng"}
    >
      <Icon name="cart" className="size-[22px]" />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-600 px-1 text-[11px] font-bold leading-none text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
```

`aria-label` đổi theo số món ("Giỏ hàng, 2 sản phẩm"); con số trên huy hiệu là `aria-hidden` để trình đọc
màn hình không đọc hai lần.

### Bước 4: Trang giỏ, `frontend/src/components/shop/CartView.tsx`

```tsx
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
```

`frontend/src/app/gio-hang/page.tsx`:

```tsx
import type { Metadata } from "next";

import { CartView } from "@/components/shop/CartView";

export const metadata: Metadata = { title: "Giỏ hàng", robots: { index: false } };

// Giỏ hàng không cần đăng nhập (khách vẫn thêm được); bấm Đặt hàng mới phải đăng nhập.
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-3 py-6 md:px-6">
      <h1 className="text-2xl font-bold md:text-3xl">Giỏ hàng</h1>
      <CartView />
    </div>
  );
}
```

Trang giỏ **không** nằm trong `proxy.ts`: khách chưa đăng nhập vẫn xem giỏ; bấm "Đăng nhập để đặt hàng"
mới sang trang đăng nhập (`?next=/thanh-toan`).

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
```

| Làm gì | Thấy gì |
|---|---|
| Chưa đăng nhập, trang nước hoa: chọn 50ml, bấm "+", "Thêm vào giỏ" | Huy hiệu "2"; DevTools → Application → Local Storage có `airlife-cart` |
| Thêm cà phê, mở `/gio-hang` | Hai dòng; cảnh báo "không có cách nhận hàng chung"; nút đặt hàng mờ |
| Xoá nước hoa | Cảnh báo biến mất, nút "Đăng nhập để đặt hàng" bấm được |
| F5 | Giỏ vẫn còn; console không có lỗi hydration |
| Đăng nhập | Huy hiệu giữ nguyên số; `airlife-cart` còn `"items":[]`; `GET /me/cart` có cà phê |

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Console: `Hydration failed because the server rendered text didn't match the client` ở icon giỏ | `persist` đọc `localStorage` lúc tạo store; thêm `skipHydration` và `rehydrate()` trong `useEffect` |
| `TS18048: 'current' is possibly 'undefined'` ở `add` | Bản đầu viết `getQueryData(...) ?? await fetchQuery(...)`, TypeScript không suy ra được kiểu. Dùng `ensureQueryData` |
| Đăng nhập xong số món nhân đôi | Server cộng dồn khi gộp; phải `GREATEST` |
