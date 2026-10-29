import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import { AppShell } from "@/components/layout/AppShell";

import "./globals.css";

// next/font tải font lúc build và tự host cùng site: trình duyệt không phải gọi sang
// Google Fonts (nhanh hơn, không lộ IP khách cho bên thứ ba), và không bị nháy font.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans", // tailwind.config.ts: fontFamily.sans dùng biến này
});

export const metadata: Metadata = {
  // Gốc để Next.js dựng URL tuyệt đối cho ảnh Open Graph
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Airlife – Đời sống hàng không",
    template: "%s | Airlife", // trang con: "Xem | Airlife"
  },
  description:
    "Mạng xã hội trên không cho khách bay và doanh nghiệp: phim, nhạc, mua sắm, vé bay, tour và tiện ích chuyến bay.",
  applicationName: "Airlife",
};

export const viewport: Viewport = {
  themeColor: "#6c3c8b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
