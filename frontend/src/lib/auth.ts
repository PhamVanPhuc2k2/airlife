"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { ApiError, api } from "./api";
import type { User } from "./types";

// Người đang đăng nhập là "dữ liệu từ server" → giữ bằng TanStack Query (key ["auth","me"]),
// không cần store Zustand riêng. Đăng nhập/đăng xuất chỉ việc cập nhật đúng key này, mọi chỗ
// dùng useMe() (header, menu dọc, trang Bạn) tự vẽ lại.
export const meKey = ["auth", "me"] as const;

// Cookie al_session (không HttpOnly) chỉ là dấu hiệu "có phiên" (backend/internal/auth/handler.go).
// Không có thì chắc chắn là khách, khỏi gọi /auth/me để nhận về 401.
function hasSessionCookie(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith("al_session="));
}

const noopSubscribe = () => () => {};

// useSyncExternalStore: đọc giá trị nằm NGOÀI React (cookie) mà không lệch giữa server và trình
// duyệt. Ba trạng thái:
//   null  : CHƯA BIẾT. Server không đọc được cookie của trình duyệt, và lần render đầu lúc
//           hydrate ở trình duyệt cũng phải giống server, nên cũng là null.
//   true / false: trình duyệt đã đọc document.cookie (ngay sau hydrate).
// Gộp "chưa biết" vào "không có phiên" là sai: trang Bạn tưởng phiên đã hết và đá người dùng
// sang trang đăng nhập dù họ vẫn đăng nhập (lỗi có thật lúc làm bài này).
function useHasSession(): boolean | null {
  return useSyncExternalStore(noopSubscribe, hasSessionCookie, () => null);
}

// me: tài khoản đang đăng nhập, null = khách. isLoading: chưa biết là ai (đang hydrate hoặc
// đang gọi /auth/me); lúc này đừng vội kết luận là khách.
export function useMe(): { me: User | null; isLoading: boolean } {
  const hasSession = useHasSession();
  const query = useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api<User>("/auth/me");
      } catch (err) {
        // Hết phiên (refresh cũng hỏng) → coi như khách, không phải lỗi
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    enabled: hasSession === true,
    staleTime: 5 * 60_000,
  });
  return {
    me: query.data ?? null,
    isLoading: hasSession === null || (hasSession && query.isPending),
  };
}

type Credentials = { email: string; password: string };
type RegisterInput = Credentials & { display_name: string };

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Credentials) =>
      api<User>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterInput) =>
      api<User>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      // Xoá SẠCH cache: không để sót dữ liệu riêng của người vừa đăng xuất (sau này: giỏ hàng,
      // đơn hàng…) cho người dùng tiếp theo trên cùng máy. Dữ liệu công khai sẽ tự tải lại.
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}

// Chỉ chuyển hướng tới đường dẫn TRONG site. Không kiểm tra thì kẻ gian gửi link
// /dang-nhap?next=https://trang-gia.com: khách đăng nhập xong bị đưa sang trang giả mạo
// (open redirect). "//trang-gia.com" cũng là link ra ngoài, nên chặn cả "//".
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
