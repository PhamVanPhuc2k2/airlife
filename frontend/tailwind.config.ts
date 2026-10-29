import type { Config } from "tailwindcss";

// Theme Airlife, chuyển từ skyline/scss/_variables.scss của mockup, đổi bảng màu sang
// bộ nhận diện Airlife (Brand Airlife.pdf):
//   brand  = tím #6C3C8B (Màu 1)
//   accent = cam đồng #C86E3A → vàng cam #F8AC3F (Màu 2, dải màu)
//
// Thang 50…950: tông nhạt = pha màu gốc với trắng, tông đậm = pha với đen.
// Độ tương phản với nền trắng (chuẩn WCAG AA: chữ thường ≥ 4.5, chữ lớn/icon ≥ 3):
//   brand-500 5.9 · brand-600 7.9 → chữ, link, nút chữ trắng đều đạt
//   accent-600 3.65 → CHỈ dùng cho chữ lớn, icon, nền trang trí
//   accent-700 5.1  → chữ nhỏ màu cam (giá tiền), nút cam chữ trắng
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // Mockup viết desktop-first (max-width 767/1024/1280/1536); Tailwind mobile-first.
    // Các mốc trùng với md/lg/xl/2xl mặc định, chỉ thêm xs cho điện thoại nhỏ.
    screens: {
      xs: "400px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        brand: {
          50: "#f8f5f9",
          100: "#f0ecf3",
          200: "#dacee2",
          300: "#bda7cb", // chữ/icon brand trên nền tối
          400: "#9876ae",
          500: "#7e5399",
          600: "#6c3c8b", // màu chính của logo
          700: "#593172",
          800: "#46275a",
          900: "#361e46",
          950: "#261531",
          DEFAULT: "#6c3c8b",
        },
        accent: {
          50: "#fcf8f5",
          100: "#faf0eb",
          200: "#f1dbce",
          300: "#e6bea6",
          400: "#d89a75",
          500: "#cf7f52",
          600: "#c86e3a", // đầu đậm của dải màu logo
          700: "#a45a30",
          800: "#824826",
          900: "#64371d",
          950: "#462614",
          light: "#f8ac3f", // đầu sáng của dải màu logo
          DEFAULT: "#c86e3a",
        },
        // Nền & bề mặt (giữ từ mockup: trắng xám lạnh)
        bg: "#f5f7fb",
        surface: {
          DEFAULT: "#ffffff",
          2: "#eef2f8", // chip, hover, ô phụ
          3: "#e2e8f0", // hover đậm hơn
          4: "#cbd5e1", // sao chưa chọn, viền đậm
        },
        // Chữ
        ink: {
          DEFAULT: "#0f172a", // chữ chính
          2: "#334155",
          muted: "#64748b",
          dim: "#94a3b8",
        },
        overlay: "#0b1220", // lớp phủ ảnh, footer, bản đồ Flightradar
        // Trạng thái
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#dc2626",
        flying: "#0284c7", // "đang bay" trên nền sáng
        // Thanh Player kiểu đường băng (đúng màu file thiết kế Player)
        runway: {
          track: "#3f4247",
          dash: "#a4a8b3",
          off: "#b7b7b7",
        },
      },
      fontFamily: {
        // --font-sans do next/font sinh ra trong layout.tsx
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        "card-sm": "10px",
      },
      boxShadow: {
        sm: "0 1px 2px rgb(15 23 42 / 0.04), 0 2px 8px rgb(15 23 42 / 0.04)",
        md: "0 10px 30px rgb(15 23 42 / 0.08)",
        lg: "0 20px 50px rgb(15 23 42 / 0.16)",
        brand: "0 8px 22px rgb(108 60 139 / 0.32)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(135deg, #7e5399 0%, #6c3c8b 50%, #46275a 100%)",
        // Dải màu của logo, đúng hướng: đậm → sáng
        "gradient-accent": "linear-gradient(135deg, #c86e3a 0%, #f8ac3f 100%)",
        "gradient-hero":
          "linear-gradient(0deg, rgb(11 18 32 / 0.9) 0%, rgb(11 18 32 / 0.5) 40%, rgb(11 18 32 / 0) 78%)",
        "gradient-glow":
          "radial-gradient(ellipse at 30% 0%, rgb(248 172 63 / 0.10) 0%, rgb(108 60 139 / 0.06) 35%, rgb(108 60 139 / 0) 65%)",
      },
      // Kích thước khung layout (dùng: h-header, w-sidebar, pb-player…)
      spacing: {
        header: "64px",
        topnav: "52px",
        sidebar: "232px",
        "sidebar-mini": "76px",
        tabbar: "62px",
        player: "68px",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      // Thanh Player chạy minh hoạ khi chưa nối YouTube (Phần 02 thay bằng thời gian thật)
      keyframes: {
        runway: { to: { width: "100%" } },
      },
      animation: {
        runway: "runway 90s linear forwards",
      },
    },
  },
  plugins: [],
};

export default config;
