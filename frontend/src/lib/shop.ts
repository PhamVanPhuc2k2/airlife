import type { BookingStatus, DeliveryMethod, OrderStatus } from "./types";

// Tên và mô tả cách nhận hàng (mockup: trang sản phẩm, "Nhận hàng"). Cùng khoá với backend
// (internal/order: DeliveryLabel).
export const DELIVERY: Record<DeliveryMethod, { label: string; desc: string }> = {
  gate: {
    label: "Nhận tại cửa ra máy bay",
    desc: "Đặt trước giờ bay, nhận ngay trước khi lên máy bay",
  },
  arrival: { label: "Giao tại sân bay đến", desc: "Nhân viên chờ ở sảnh đến" },
  home: { label: "Giao tận nhà", desc: "2–3 ngày, miễn phí cho đơn từ 300.000₫" },
  evoucher: { label: "Nhận mã qua email", desc: "Mã điện tử dùng tại quầy dịch vụ" },
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  pending: { label: "Chờ xác nhận", tone: "bg-warning/15 text-accent-800" },
  confirmed: { label: "Đã xác nhận", tone: "bg-brand-50 text-brand-700" },
  delivering: { label: "Đang giao", tone: "bg-brand-50 text-brand-700" },
  completed: { label: "Đã nhận hàng", tone: "bg-success/15 text-success" },
  cancelled: { label: "Đã huỷ", tone: "bg-surface-2 text-ink-muted" },
};

// Phí giao: cùng quy tắc với backend (chỉ để hiện trước; số cuối cùng do server tính)
export const HOME_SHIPPING_FEE = 30_000;
export const FREE_SHIPPING_FROM = 300_000;

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: string }> = {
  held: { label: "Đang giữ chỗ", tone: "bg-warning/15 text-accent-800" },
  awaiting_payment: { label: "Chờ thanh toán", tone: "bg-warning/15 text-accent-800" },
  confirmed: { label: "Đã xác nhận", tone: "bg-success/15 text-success" },
  cancelled: { label: "Đã huỷ", tone: "bg-surface-2 text-ink-muted" },
  expired: { label: "Hết hạn giữ chỗ", tone: "bg-surface-2 text-ink-muted" },
};

// "Nguyễn Văn  Đức" → "NGUYEN VAN DUC", giống backend (booking.PassportName): xem trước tên in
// trên vé. NFD tách chữ và dấu; \p{Mn} là các dấu; "đ" không phải "d" có dấu nên đổi tay.
export function passportName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

// "2026-11-14" → "T7, 14/11" (thứ theo giờ Việt Nam)
export function shortDate(d: string): string {
  return new Date(`${d}T00:00:00+07:00`).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}
