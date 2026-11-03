import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BoardingTab } from "@/components/flight/MyFlights";
import { FlightBoard } from "@/components/flight/FlightBoard";
import { WeatherGrid } from "@/components/flight/WeatherGrid";
import { WifiPlans } from "@/components/flight/WifiPlans";
import { ProductGrid } from "@/components/product/ProductGrid";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";
import { getQueryClient } from "@/lib/query-client";
import { productListOptions } from "@/lib/queries";

const TABS = [
  { key: "ra-tau-bay", label: "Ra tàu bay" },
  { key: "flightradar", label: "Flightradar" },
  { key: "thoi-tiet", label: "Thời tiết điểm đến" },
  { key: "wifi", label: "Wi-Fi trên máy bay" },
  { key: "phong-cho", label: "Phòng chờ & fast-track" },
] as const;

type Props = {
  params: Promise<{ tab: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  const t = TABS.find((x) => x.key === tab);
  return { title: t ? `${t.label} · Tiện ích` : "Tiện ích" };
}

// Tiện ích (mockup: renderUtility). Mỗi tab là một đường dẫn riêng: /tien-ich/flightradar?q=VN220
// dán cho người khác là mở đúng tab, đúng tìm kiếm.
export default async function Page({ params, searchParams }: Props) {
  const { tab } = await params;
  if (!TABS.some((t) => t.key === tab)) notFound();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 40);

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="radar"
        title="Tiện ích"
        desc="Mọi thứ cần cho chuyến bay: ra tàu bay, theo dõi chuyến bay, thời tiết, Wi-Fi và dịch vụ sân bay."
      />
      <TabLinks
        label="Tiện ích"
        items={TABS.map((t) => ({
          label: t.label,
          href: `/tien-ich/${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "ra-tau-bay" && <BoardingTab />}
      {tab === "flightradar" && (
        <div className="space-y-4">
          <form action="/tien-ich/flightradar" role="search" className="flex max-w-xl gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={40}
              placeholder="Số hiệu chuyến bay hoặc sân bay, VD: VN 220, SGN"
              aria-label="Tìm chuyến bay"
              className="h-11 min-w-0 flex-1 rounded-full bg-surface px-5 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-full bg-gradient-brand px-6 font-semibold text-white"
            >
              Tìm
            </button>
          </form>
          <FlightBoard q={q} />
        </div>
      )}
      {tab === "thoi-tiet" && <WeatherGrid />}
      {tab === "wifi" && <WifiPlans />}
      {tab === "phong-cho" && <LoungeGrid />}
    </div>
  );
}

// Phòng chờ, fast-track là sản phẩm của chuyên mục Kinh doanh, gắn nhãn dịch-vu-san-bay
async function LoungeGrid() {
  const queryClient = getQueryClient();
  const params = { category: "kinh-doanh", tag: "dich-vu-san-bay", sort: "new" } as const;
  await queryClient.prefetchInfiniteQuery(productListOptions(params));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductGrid category={params.category} tag={params.tag} sort={params.sort} />
    </HydrationBoundary>
  );
}
