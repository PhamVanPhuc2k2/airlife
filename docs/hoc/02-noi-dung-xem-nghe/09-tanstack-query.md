# Bài 2.09: TanStack Query: cài đặt và khai báo truy vấn

> [← Bài trước](08-goi-api-tu-nextjs.md) · [Mục lục](../README.md) · [Bài sau →](10-trang-chu.md)

## Mục tiêu

TanStack Query sẵn sàng cho mọi trang: `QueryClient` đúng cách cho App Router, provider bọc layout,
và truy vấn danh sách media khai báo một lần dùng cho cả server lẫn client.

## Bạn sẽ học

- TanStack Query lo việc gì (cache, tải lại, phân trang, trạng thái loading/lỗi) để mình khỏi tự viết.
- Vì sao server phải tạo `QueryClient` **mới cho mỗi request**.
- `infiniteQueryOptions`: một chỗ khai báo key + hàm lấy dữ liệu.

## Viết code

### Bước 1: Cài đặt

```bash
make npm c="install --save-exact @tanstack/react-query@5.105.0"
make npm c="install --save-exact --save-dev @tanstack/react-query-devtools@5.105.0"
```

Zustand (Phần 01) giữ **trạng thái giao diện** (menu mở, bài đang phát). TanStack Query giữ **dữ liệu
từ server** (danh sách media): tự cache theo key, tự bỏ request khi rời trang, tự gộp các trang khi
cuộn tải thêm. Hai thư viện, hai việc khác nhau.

### Bước 2: `frontend/src/lib/query-client.ts`

```ts
import { QueryClient, isServer } from "@tanstack/react-query";

// Theo hướng dẫn "Advanced Server Rendering" của TanStack Query cho Next.js App Router.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Dữ liệu lấy sẵn trên server coi là còn mới trong 60 giây: client nhận về thì dùng
        // luôn, không gọi API lại ngay lúc trang vừa hiện.
        staleTime: 60_000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // Server: mỗi request một QueryClient mới. Dùng chung sẽ lẫn dữ liệu giữa các khách.
  if (isServer) return makeQueryClient();
  // Trình duyệt: một QueryClient cho cả phiên, giữ cache khi chuyển trang.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
```

Trên server, mỗi request là một khách khác nhau. Một `QueryClient` dùng chung cho mọi request thì
khách B có thể nhận dữ liệu của khách A (sau này có dữ liệu riêng như giỏ hàng, đơn hàng thì rất nguy
hiểm). Trên trình duyệt chỉ có một khách, dùng một `QueryClient` cho cả phiên để cache còn khi chuyển trang.

### Bước 3: `frontend/src/components/providers/QueryProvider.tsx`

```tsx
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { getQueryClient } from "@/lib/query-client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Nút xem cache của TanStack Query ở góc màn hình; tự biến mất ở bản production */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
```

Bọc trong `frontend/src/app/layout.tsx`, bên ngoài `AppShell`:

```tsx
import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import { AppShell } from "@/components/layout/AppShell";
import { QueryProvider } from "@/components/providers/QueryProvider";

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
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
```

### Bước 4: `frontend/src/lib/queries.ts`

```ts
import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type { MediaPage } from "./types";

// Mỗi truy vấn khai báo một lần (key + hàm lấy dữ liệu) bằng infiniteQueryOptions, dùng chung
// cho server (prefetch) và client (useInfiniteQuery). Key giống nhau thì client nhận lại đúng
// dữ liệu server đã lấy.

export type MediaListParams = {
  category: string;
  tag?: string;
  sort?: "new" | "popular";
};

export function mediaListOptions(p: MediaListParams) {
  return infiniteQueryOptions({
    queryKey: ["media", "list", p.category, p.tag ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<MediaPage>(
        `/media?${qs({ category: p.category, tag: p.tag, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal }, // rời trang giữa chừng thì huỷ request
      ),
    initialPageParam: "",
    // next_cursor rỗng → undefined → TanStack hiểu là hết trang
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
```

- **`queryKey`**: định danh của dữ liệu trong cache. Đổi chip lọc → key khác → cache khác; quay lại
  chip cũ là có ngay, không gọi lại API (trong 60 giây `staleTime`).
- **`pageParam`**: với `useInfiniteQuery`, là con trỏ trang. Trang đầu `""`, các trang sau lấy từ
  `getNextPageParam` (= `next_cursor` của API, bài 2.05).
- **`signal`**: TanStack truyền vào để huỷ `fetch` khi không cần nữa.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint && make fe-audit
```

Mở http://localhost:3000: góc dưới trái có nút hình bông hoa của TanStack Query Devtools (chỉ có khi dev).

```bash
git add . && git commit -m "TanStack Query"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| `No QueryClient set, use QueryClientProvider to set one` | Component dùng `useQuery` nằm ngoài `QueryProvider` |
| Dữ liệu của trang này hiện ở trang khác | Hai truy vấn khác nhau dùng trùng `queryKey` |
