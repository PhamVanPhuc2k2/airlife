"use client";

import { YouTubeHost } from "@/components/player/YouTubeHost";
import { CartSync } from "@/lib/cart";
import { usePlayerStore } from "@/stores/player-store";
import { useUIStore } from "@/stores/ui-store";

import { Footer } from "./Footer";
import { Header } from "./Header";
import { MiniPlayer } from "./MiniPlayer";
import { SidebarDrawer, SidebarDocked, SidebarRail } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TopNav } from "./TopNav";

// Khung chung của mọi trang (thay js/layout.js của mockup).
//
// Thẻ bọc ngoài cùng mang hai thuộc tính data-*:
//   data-collapsed: người dùng thu gọn menu dọc (chỉ có tác dụng ở màn ≥ 1280px)
//   data-playing:   đang có mini player → chừa chỗ dưới đáy để nội dung không bị che
// Các phần con dùng biến thể Tailwind `group-data-[...]/app:` để đổi vị trí theo hai thuộc tính
// này, nên chỉ AppShell cần đọc store, các phần con vẫn là component tĩnh.
//
// Độ rộng menu dọc theo màn hình (Tailwind mobile-first):
//   < 768px  (mặc định): không có menu dọc, dùng thanh tab dưới đáy; ☰ mở ngăn kéo
//   768–1279 (md):       thanh icon hẹp 76px; ☰ mở ngăn kéo đầy đủ đè lên nội dung
//   ≥ 1280   (xl):       menu đầy đủ 232px; ☰ thu gọn thành thanh icon 76px
export function AppShell({ children }: { children: React.ReactNode }) {
  const navCollapsed = useUIStore((s) => s.navCollapsed);
  // Thanh mini player chỉ hiện khi đang phát và không ở trang xem (MiniPlayer.tsx)
  const hasPlayer = usePlayerStore((s) => s.current !== null && s.slot === null);

  return (
    <div className="group/app" data-collapsed={navCollapsed} data-playing={hasPlayer}>
      {/* Người dùng bàn phím/trình đọc màn hình bỏ qua menu, nhảy thẳng tới nội dung */}
      <a
        href="#noi-dung"
        className="sr-only z-[200] rounded-card-sm bg-brand-600 px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Bỏ qua menu
      </a>

      <CartSync />
      <Header />
      <TopNav />
      <SidebarRail />
      <SidebarDocked />
      <SidebarDrawer />

      <div
        className={
          // Chừa chỗ cho header + menu ngang ở trên, menu dọc bên trái, thanh tab/mini player ở dưới
          "flex min-h-screen flex-col bg-gradient-glow bg-no-repeat " +
          "pb-tabbar pt-[calc(theme(spacing.header)_+_theme(spacing.topnav))] " +
          "transition-[margin] duration-300 ease-brand " +
          "md:ml-sidebar-mini md:pb-0 xl:ml-sidebar xl:group-data-[collapsed=true]/app:ml-sidebar-mini " +
          "group-data-[playing=true]/app:pb-[calc(theme(spacing.tabbar)_+_theme(spacing.player))] " +
          "md:group-data-[playing=true]/app:pb-player"
        }
      >
        <main id="noi-dung" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>

      <YouTubeHost />
      <MiniPlayer />
      <TabBar />
    </div>
  );
}
