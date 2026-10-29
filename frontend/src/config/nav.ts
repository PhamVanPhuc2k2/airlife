import type { IconName } from "@/components/icons/Icon";

// Hai menu của mockup (skyline/js/layout.js: SIDENAV, TOPNAV), đổi đường dẫn .html sang route
// Next.js theo bảng ở TASKS.md mục 3.5. Header, menu dọc, menu ngang, thanh tab và footer
// đều đọc từ đây: thêm/bớt mục chỉ sửa một chỗ.

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: IconName;
};

export type TopNavItem = NavItem & {
  subs: { label: string; href: string; desc: string }[];
};

// Menu dọc (kiểu YouTube). 5 mục đầu cũng là thanh tab dưới cùng trên điện thoại.
export const SIDENAV: NavItem[] = [
  { key: "home", label: "Home", href: "/", icon: "home" },
  { key: "xem", label: "Xem", href: "/xem", icon: "screen" },
  { key: "nghe", label: "Nghe", href: "/nghe", icon: "sound" },
  { key: "moi-tai", label: "Mới tải", href: "/moi-tai", icon: "sparkle" },
  { key: "ban", label: "Bạn", href: "/ban", icon: "user" },
  { key: "suu-tap", label: "Sưu tập", href: "/suu-tap", icon: "library" },
];

// Menu ngang: chuyên mục, rê chuột (hoặc Tab tới) thì xổ tiểu mục.
export const TOPNAV: TopNavItem[] = [
  {
    key: "tien-ich",
    label: "Tiện ích",
    href: "/tien-ich",
    icon: "radar",
    subs: [
      { label: "Ra tàu bay", href: "/tien-ich/ra-tau-bay", desc: "Check-in, giờ lên tàu, hành lý" },
      {
        label: "Flightradar",
        href: "/tien-ich/flightradar",
        desc: "Theo dõi chuyến bay trực tiếp",
      },
      { label: "Thời tiết điểm đến", href: "/tien-ich/thoi-tiet", desc: "Dự báo tại sân bay đến" },
      { label: "Wi-Fi trên máy bay", href: "/tien-ich/wifi", desc: "Gói kết nối theo chặng bay" },
      {
        label: "Phòng chờ & fast-track",
        href: "/tien-ich/phong-cho",
        desc: "Đặt trước dịch vụ sân bay",
      },
    ],
  },
  {
    key: "tin-tuc",
    label: "Tin tức",
    href: "/tin-tuc",
    icon: "news",
    subs: [
      { label: "Khám phá", href: "/tin-tuc?f=kham-pha", desc: "Điểm đến, sân bay, văn hóa" },
      { label: "Sự kiện", href: "/tin-tuc?f=su-kien", desc: "Tin hoạt động Airlife" },
      { label: "Mẹo bay", href: "/tin-tuc?f=meo-bay", desc: "Bay thông minh, thoải mái" },
      { label: "Line-up phim", href: "/tin-tuc?f=line-up-phim", desc: "Phim mới trên chuyến bay" },
    ],
  },
  {
    key: "kinh-doanh",
    label: "Kinh doanh",
    href: "/kinh-doanh",
    icon: "briefcase",
    subs: [
      { label: "Vé bay", href: "/kinh-doanh?f=ve-bay", desc: "Giá tốt cho chặng tiếp theo" },
      { label: "Miễn thuế", href: "/kinh-doanh?f=mien-thue", desc: "Nhận tại cửa ra máy bay" },
      { label: "Mua sắm", href: "/kinh-doanh?f=mua-sam", desc: "Đồ du lịch, quà tặng" },
      { label: "Đặc sản", href: "/kinh-doanh?f=dac-san", desc: "Quà vùng miền chính gốc" },
      {
        label: "Dịch vụ sân bay",
        href: "/kinh-doanh?f=dich-vu-san-bay",
        desc: "Phòng chờ, fast-track, đưa đón",
      },
    ],
  },
  {
    key: "y-kien",
    label: "Ý kiến",
    href: "/y-kien",
    icon: "chat",
    subs: [
      { label: "Trải nghiệm", href: "/y-kien/trai-nghiem", desc: "Chia sẻ chuyến bay của bạn" },
      { label: "Khảo sát", href: "/y-kien/khao-sat", desc: "Bình chọn, xem kết quả" },
      { label: "Góp ý", href: "/y-kien/gop-y", desc: "Gửi phản hồi cho Airlife" },
    ],
  },
  {
    key: "tour-bay",
    label: "Tour bay",
    href: "/tour-bay",
    icon: "globe",
    subs: [
      { label: "Trong nước", href: "/tour-bay?f=trong-nuoc", desc: "Phú Quốc, Đà Lạt, Phong Nha…" },
      { label: "Quốc tế", href: "/tour-bay?f=quoc-te", desc: "Nhật Bản, Hàn Quốc…" },
      {
        label: "Combo bay + khách sạn",
        href: "/tour-bay?f=combo",
        desc: "Trọn gói, tự do lịch trình",
      },
    ],
  },
];

// Mục có đang mở không, theo đường dẫn hiện tại. "/" chỉ khớp đúng trang chủ;
// mục khác khớp cả trang con: /xem/abc vẫn sáng mục "Xem".
export function isActive(pathname: string, href: string): boolean {
  const base = href.split("?")[0] ?? href;
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}
