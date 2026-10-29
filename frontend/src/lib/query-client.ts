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
