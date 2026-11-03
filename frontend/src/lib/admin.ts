"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, qs } from "./api";

// Trang quản trị (Phần 12). Mọi truy vấn có key bắt đầu bằng ["me", "admin"]: đăng xuất thì
// useLogout xoá sạch, người dùng sau trên cùng máy không thấy dữ liệu quản trị còn trong cache.

export type AdminPage<T> = { items: T[]; total: number; page: number; size: number };

export type AdminComment = {
  id: string;
  body: string;
  status: "visible" | "hidden" | "deleted";
  like_count: number;
  created_at: string;
  author: string;
  target: string;
};
export type AdminExperience = {
  id: string;
  route: string;
  rating: number;
  body: string;
  status: "visible" | "hidden" | "deleted";
  like_count: number;
  created_at: string;
  author: string;
};
export type AdminFeedback = {
  id: string;
  topic: string;
  rating: number;
  body: string;
  flight_code: string | null;
  email: string | null;
  status: "new" | "done";
  created_at: string;
  author: string;
};
export type AdminSurvey = {
  id: string;
  question: string;
  status: "open" | "closed" | "hidden";
  votes: number;
  options: number;
  created_at: string;
};
export type AdminOrder = {
  code: string;
  status: string;
  delivery_method: string;
  recipient_name: string;
  phone: string;
  total: number;
  created_at: string;
};
export type AdminOrderDetail = AdminOrder & {
  email: string;
  customer: string;
  flight_code: string | null;
  flight_date: string | null;
  address: string | null;
  note: string;
  subtotal: number;
  shipping_fee: number;
  items: {
    product_name: string;
    variant_label: string;
    unit_price: number;
    quantity: number;
    line_total: number;
  }[];
  next: string[] | null;
};
export type AdminRefund = {
  code: string;
  amount: number;
  provider: string;
  reason: string | null;
  pending: boolean;
  refunded_at: string | null;
  note: string | null;
  paid_at: string | null;
  booking_code: string;
  product_name: string;
  booking_status: string;
  email: string;
  customer: string;
};
export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: "active" | "locked";
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
};
export type AdminStats = Record<
  | "users_total"
  | "users_week"
  | "orders_total"
  | "orders_pending"
  | "orders_revenue"
  | "bookings_confirmed"
  | "payments_revenue"
  | "refunds_pending"
  | "feedbacks_new"
  | "comments_hidden"
  | "media_views",
  number
>;
export type AuditEntry = {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
  actor: string;
};

// Danh sách phân trang offset; giữ trang cũ trên màn hình trong lúc tải trang mới (không nháy trắng)
export function useAdminList<T>(path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ["me", "admin", path, params],
    queryFn: ({ signal }) => api<AdminPage<T>>(`/admin/${path}?${qs(params)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminGet<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["me", "admin", path],
    queryFn: ({ signal }) => api<T>(`/admin/${path}`, { signal }),
    enabled,
  });
}

// Ghi (PATCH/POST/DELETE) rồi tải lại mọi danh sách quản trị
export function useAdminAction(path: string, method: "PATCH" | "POST" | "DELETE" = "PATCH") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: unknown) =>
      api<unknown>(`/admin/${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["me", "admin"] }),
  });
}
