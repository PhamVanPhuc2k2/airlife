import { infiniteQueryOptions } from "@tanstack/react-query";

import { api, qs } from "./api";
import type {
  BookingPage,
  CommentPage,
  LibraryPage,
  MediaPage,
  NewsPage,
  OrderPage,
  ProductPage,
} from "./types";

// Mỗi truy vấn khai báo một lần (key + hàm lấy dữ liệu) bằng infiniteQueryOptions, dùng chung
// cho server (prefetch) và client (useInfiniteQuery). Key giống nhau thì client nhận lại đúng
// dữ liệu server đã lấy.

export type MediaListParams = {
  category?: string; // bỏ trống = mọi chuyên mục (trang Mới tải)
  tag?: string;
  channel?: string; // trang kênh
  sort?: "new" | "popular";
};

export function mediaListOptions(p: MediaListParams) {
  return infiniteQueryOptions({
    queryKey: ["media", "list", p.category ?? "", p.tag ?? "", p.channel ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<MediaPage>(
        `/media?${qs({ category: p.category, tag: p.tag, channel: p.channel, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal }, // rời trang giữa chừng thì huỷ request
      ),
    initialPageParam: "",
    // next_cursor rỗng → undefined → TanStack hiểu là hết trang
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function newsListOptions(category?: string) {
  return infiniteQueryOptions({
    queryKey: ["news", "list", category ?? ""],
    queryFn: ({ pageParam, signal }) =>
      api<NewsPage>(`/news?${qs({ category, cursor: pageParam, limit: 12 })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export type CommentTarget = { kind: "media" | "news"; slug: string };

// Bình luận của một media/bài viết. Lấy ở trình duyệt (có cookie) vì kèm liked_by_me, mine.
export function commentsOptions(t: CommentTarget, sort: "top" | "new") {
  return infiniteQueryOptions({
    queryKey: ["comments", t.kind, t.slug, sort],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/${t.kind}/${t.slug}/comments?${qs({ sort, cursor: pageParam })}`, {
        signal,
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function repliesOptions(commentId: string) {
  return infiniteQueryOptions({
    queryKey: ["comments", "replies", commentId],
    queryFn: ({ pageParam, signal }) =>
      api<CommentPage>(`/comments/${commentId}/replies?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

// Lịch sử xem / đã lưu của người đang đăng nhập. Key bắt đầu bằng "me": đăng xuất thì
// useLogout xoá sạch cache, không để lộ cho người dùng sau trên cùng máy.
export function libraryListOptions(list: "history" | "saved") {
  return infiniteQueryOptions({
    queryKey: ["me", list],
    queryFn: ({ pageParam, signal }) =>
      api<LibraryPage>(`/me/${list}?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export type ProductListParams = {
  category?: string; // kinh-doanh | tour-bay
  tag?: string;
  channel?: string; // gian hàng của một kênh
  sort?: "new" | "bestseller";
};

export function productListOptions(p: ProductListParams) {
  return infiniteQueryOptions({
    queryKey: ["products", "list", p.category ?? "", p.tag ?? "", p.channel ?? "", p.sort ?? "new"],
    queryFn: ({ pageParam, signal }) =>
      api<ProductPage>(
        `/products?${qs({ category: p.category, tag: p.tag, channel: p.channel, sort: p.sort, cursor: pageParam, limit: 24 })}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function favoritesOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "favorites"],
    queryFn: ({ pageParam, signal }) =>
      api<ProductPage>(`/me/favorites?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function ordersOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "orders"],
    queryFn: ({ pageParam, signal }) =>
      api<OrderPage>(`/me/orders?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}

export function bookingsOptions() {
  return infiniteQueryOptions({
    queryKey: ["me", "bookings"],
    queryFn: ({ pageParam, signal }) =>
      api<BookingPage>(`/me/bookings?${qs({ cursor: pageParam })}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
}
