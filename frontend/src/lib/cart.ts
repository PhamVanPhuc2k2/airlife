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
