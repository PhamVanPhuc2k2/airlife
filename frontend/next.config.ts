import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gói gọn server + thư viện cần thiết vào .next/standalone để image production nhỏ.
  output: "standalone",
  // Không gửi header "X-Powered-By: Next.js": không cần cho kẻ tấn công biết dùng gì.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Thumbnail video YouTube
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
};

export default nextConfig;
