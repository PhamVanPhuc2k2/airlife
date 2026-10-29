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
