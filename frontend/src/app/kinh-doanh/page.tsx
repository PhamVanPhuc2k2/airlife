import type { Metadata } from "next";

import { ProductCategoryPage } from "@/components/product/ProductCategoryPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kinh doanh" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page({ searchParams }: Props) {
  return <ProductCategoryPage slug="kinh-doanh" searchParams={searchParams} />;
}
