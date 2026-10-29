import { create } from "zustand";

// Trạng thái giao diện dùng chung giữa Header (nút ☰) và menu dọc.
//
// Nút ☰ làm hai việc khác nhau tuỳ độ rộng màn hình (giống YouTube):
//   ≥ 1280px: thu gọn / mở rộng menu dọc tại chỗ (navCollapsed)
//   < 1280px: mở / đóng menu dạng ngăn kéo đè lên nội dung (drawerOpen)
type UIState = {
  navCollapsed: boolean;
  drawerOpen: boolean;
  toggleNav: () => void;
  setDrawerOpen: (open: boolean) => void;
};

// Cùng mốc với `xl` trong tailwind.config.ts
const DESKTOP_QUERY = "(min-width: 1280px)";

export const useUIStore = create<UIState>()((set) => ({
  navCollapsed: false,
  drawerOpen: false,
  toggleNav: () => {
    // Chỉ chạy khi người dùng bấm nút, lúc đó chắc chắn đang ở trình duyệt (có window).
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      set((s) => ({ navCollapsed: !s.navCollapsed }));
    } else {
      set((s) => ({ drawerOpen: !s.drawerOpen }));
    }
  },
  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));
