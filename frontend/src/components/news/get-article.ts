import { notFound } from "next/navigation";
import { cache } from "react";

import { ApiError, api } from "@/lib/api";
import type { Article } from "@/lib/types";

// Giống getMedia (bài 2.12): dùng chung cho generateMetadata và trang, gọi API một lần.
export const getArticle = cache(async (slug: string): Promise<Article> => {
  try {
    return await api<Article>(`/news/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});
