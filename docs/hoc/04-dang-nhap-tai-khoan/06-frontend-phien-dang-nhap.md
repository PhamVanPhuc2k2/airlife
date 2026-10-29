# Bài 4.06: Frontend: gửi cookie, tự làm mới phiên, `useMe`

> [← Bài trước](05-cookie-middleware-csrf.md) · [Mục lục](../README.md) · [Bài sau →](07-trang-dang-nhap-dang-ky.md)

## Mục tiêu

`api()` gửi kèm cookie và tự làm mới phiên khi access token hết hạn. `lib/auth.ts` có `useMe`,
`useLogin`, `useRegister`, `useLogout`, `safeNext`.

## Bạn sẽ học

- `credentials: "include"` cho request khác cổng/khác domain.
- "Single-flight": nhiều request cùng hết hạn chỉ làm mới **một** lần.
- Người đang đăng nhập là **dữ liệu server** → TanStack Query, không cần store riêng.
- `useSyncExternalStore` và trạng thái "chưa biết" lúc hydrate.
- Open redirect.

## Viết code

### Bước 1: `frontend/src/lib/api.ts`

```ts
// Gọi API backend. Dùng được ở cả server component lẫn client component.
//
// Hai địa chỉ khác nhau cho cùng một API:
//   - Trên server (container frontend): gọi thẳng service `api` trong mạng Docker, không đi vòng
//     ra ngoài máy.
//   - Trên trình duyệt: trình duyệt nằm trên máy người dùng, chỉ biết cổng API mở ra ngoài.
const API_URL =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? "http://localhost:8080")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080");

// Lỗi từ API, đúng khuôn {"error": {"code", "message", "request_id"}} của backend (pkg/response).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    // Lỗi theo từng trường của form: {"email": "Email này đã được đăng ký"}
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = {
  data?: T;
  error?: { code: string; message: string; request_id?: string; fields?: Record<string, string> };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    // Access token (15 phút) hết hạn: xin token mới bằng refresh token rồi thử lại MỘT lần.
    // Chỉ ở trình duyệt; server Next.js không giữ cookie của khách để làm mới.
    if (
      typeof window !== "undefined" &&
      err instanceof ApiError &&
      err.code === "token_expired" &&
      (await refreshSession())
    ) {
      return request<T>(path, init);
    }
    throw err;
  }
}

// Nhiều request cùng hết hạn một lúc (trang gọi 3 API song song) thì chỉ gọi /auth/refresh
// MỘT lần: các request sau dùng chung Promise của lần đầu. Gọi 3 lần thì lần 2, 3 gửi refresh
// token mà lần 1 vừa đổi, backend sẽ tưởng token bị đánh cắp.
let refreshing: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  refreshing ??= request("/auth/refresh", { method: "POST" })
    .then(() => true)
    .catch((err: unknown) => {
      // Tab khác vừa làm mới trước: cookie đã là token mới, coi như thành công
      return err instanceof ApiError && err.code === "refresh_race";
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    // Dữ liệu đã được backend cache bằng Redis; Next.js không cache thêm lớp nữa
    cache: "no-store",
    // Gửi kèm cookie đăng nhập dù API khác cổng (localhost:8080) với trang (localhost:3000).
    // Backend phải bật CORS AllowCredentials (bài 0.08) thì trình duyệt mới cho đọc phản hồi.
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, "bad_response", "Máy chủ trả dữ liệu không hợp lệ");
  }
  if (!res.ok || body.error) {
    throw new ApiError(
      res.status,
      body.error?.code ?? "unknown",
      body.error?.message ?? "Có lỗi xảy ra, vui lòng thử lại sau",
      body.error?.request_id,
      body.error?.fields,
    );
  }
  return body.data as T;
}

// Ghép query string, bỏ qua tham số rỗng: qs({ a: "x", b: undefined }) → "a=x"
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}
```

- **`credentials: "include"`**: trang ở `localhost:3000`, API ở `localhost:8080`. Mặc định `fetch` không
  gửi cookie sang origin khác. Backend phải trả `Access-Control-Allow-Credentials: true` (đã bật ở bài 0.08).
- **`refreshing ??= …`**: trang Bạn gọi 3 API song song, cả 3 cùng nhận `token_expired`. Nếu mỗi cái tự
  gọi `/auth/refresh` thì lần 2, 3 gửi refresh token mà lần 1 vừa đổi → backend tưởng bị đánh cắp
  (bài 4.03). Giữ chung một Promise: lần đầu gọi thật, các lần sau chờ chung kết quả.
- **`fields`** trong `ApiError`: lỗi theo từng ô của form từ backend.

### Bước 2: Kiểu `User`

Thêm vào cuối `frontend/src/lib/types.ts`:

```ts
// Tài khoản đang đăng nhập (GET /auth/me). Khớp backend/internal/auth/service.go: User
export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "creator" | "business" | "editor" | "admin";
  email_verified: boolean;
  created_at: string;
};
```

### Bước 3: `frontend/src/lib/auth.ts`

```ts
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
```

- **Không cần `useAuthStore`** (TASKS.md có ghi): người đang đăng nhập do server quyết định, nên giữ
  trong cache TanStack Query (key `["auth","me"]`). Đăng nhập xong `setQueryData` là mọi chỗ dùng
  `useMe()` tự cập nhật.
- **`enabled: hasSession === true`**: khách (không có cookie `al_session`) thì khỏi gọi `/auth/me`.
- **`qc.clear()` khi đăng xuất**: người sau dùng cùng máy không thấy dữ liệu riêng của người trước.
- **`safeNext`**: `/dang-nhap?next=https://trang-gia.com`. Nếu chuyển hướng theo `next` mà không kiểm tra,
  khách đăng nhập xong bị đưa sang trang giả mạo trông y hệt Airlife (open redirect). Chỉ nhận đường dẫn
  bắt đầu bằng `/` và không bắt đầu bằng `//` (`//trang-gia.com` cũng là link ra ngoài).

### Lỗi có thật: trạng thái "chưa biết"

Bản đầu viết `useHasSession` trả `boolean`, server trả `false`. Thử: đăng nhập, đợi access token hết hạn,
**tải lại** trang `/ban` → bị đá sang trang đăng nhập, dù phiên vẫn còn (và `/auth/refresh` đã chạy đúng).

Lý do: lần render đầu khi hydrate phải giống server, nên `hasSession = false` → truy vấn tắt →
`isLoading = false`, `me = undefined` → trang Bạn kết luận "phiên hết" và chuyển trang **trước** khi
trình duyệt kịp đọc cookie. Thử chuyển trang trong app thì không gặp (không có hydrate), nên lỗi này
dễ lọt.

Sửa: ba trạng thái `null | true | false`. `null` (server và lúc hydrate) nghĩa là **chưa biết**, và
`useMe` báo `isLoading` cho tới khi biết chắc.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
git add . && git commit -m "Frontend: phiên đăng nhập, tự làm mới"
```

Thử đầy đủ ở bài 4.08.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Đăng nhập xong `/auth/me` vẫn 401 | `fetch` thiếu `credentials: "include"`: cookie không được gửi sang `localhost:8080` |
| Console: `blocked by CORS policy … Access-Control-Allow-Credentials` | Backend thiếu `AllowCredentials: true` |
| Mở nhiều tab thì hay bị đăng xuất | Mỗi request tự gọi refresh riêng; phải dùng chung Promise |
