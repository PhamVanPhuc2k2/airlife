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
