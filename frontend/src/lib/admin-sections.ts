// Các mục của khu quản trị và vai trò được vào. Nằm ngoài file "use client" để cả trang server
// (kiểm tra mục có tồn tại) lẫn khung client (ẩn menu) cùng dùng được.
export const SECTIONS = [
  { key: "tong-quan", label: "Tổng quan", roles: ["admin"] },
  { key: "binh-luan", label: "Bình luận", roles: ["editor", "admin"] },
  { key: "trai-nghiem", label: "Trải nghiệm", roles: ["editor", "admin"] },
  { key: "gop-y", label: "Góp ý", roles: ["editor", "admin"] },
  { key: "khao-sat", label: "Khảo sát", roles: ["editor", "admin"] },
  { key: "don-hang", label: "Đơn hàng", roles: ["admin"] },
  { key: "hoan-tien", label: "Hoàn tiền", roles: ["admin"] },
  { key: "nguoi-dung", label: "Người dùng", roles: ["admin"] },
] as const;
