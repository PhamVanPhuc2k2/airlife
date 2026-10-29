import { notFound } from "next/navigation";
import { cache } from "react";

import { ApiError, api } from "@/lib/api";
import type { MediaDetail } from "@/lib/types";

// cache() của React: trong CÙNG một request, gọi getMedia(slug) nhiều lần (generateMetadata và
// trang) chỉ gọi API một lần.
export const getMedia = cache(async (slug: string): Promise<MediaDetail> => {
  try {
    return await api<MediaDetail>(`/media/${encodeURIComponent(slug)}`);
  } catch (err) {
    // API trả 404 → trang 404 của Next (mã HTTP 404, dùng not-found.tsx)
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});
