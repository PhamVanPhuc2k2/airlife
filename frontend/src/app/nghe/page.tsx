import type { Metadata } from "next";

import { CategoryPage } from "@/components/category/CategoryPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nghe" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page({ searchParams }: Props) {
  return <CategoryPage slug="nghe" searchParams={searchParams} />;
}
