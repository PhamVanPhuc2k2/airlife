import type { Metadata } from "next";

import { ArticlePage } from "@/components/news/ArticlePage";
import { getArticle } from "@/components/news/get-article";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = await getArticle((await params).slug);
  return {
    title: a.title,
    description: a.excerpt,
    // type "article" + thời gian đăng: Facebook/Zalo hiện đúng kiểu thẻ bài viết
    openGraph: {
      type: "article",
      title: a.title,
      description: a.excerpt,
      images: [a.cover_url],
      publishedTime: a.published_at,
      modifiedTime: a.updated_at,
    },
  };
}

export default async function Page({ params }: Props) {
  return <ArticlePage slug={(await params).slug} />;
}
