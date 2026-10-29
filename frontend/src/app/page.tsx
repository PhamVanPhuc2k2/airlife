import { HotComments } from "@/components/comment/HotComments";
import { FeaturedHero } from "@/components/media/FeaturedHero";
import { MediaCard } from "@/components/media/MediaCard";
import { MediaTile } from "@/components/media/MediaTile";
import { RankList } from "@/components/media/RankList";
import { ProductMiniList } from "@/components/product/ProductMiniList";
import { Panel } from "@/components/ui/Panel";
import { api } from "@/lib/api";
import type { Home } from "@/lib/types";

// Trang lấy dữ liệu từ API lúc có request, không dựng sẵn lúc build (lúc build không có API
// để gọi). Dữ liệu đã được backend cache 60 giây bằng Redis.
export const dynamic = "force-dynamic";

// Server component: lấy dữ liệu ngay trên server, gửi về HTML có sẵn nội dung (tốt cho SEO,
// hiện nhanh). Chỉ cột Bình luận nổi bật (đổi tab Hay/Nhiều) là client component.
export default async function HomePage() {
  const home = await api<Home>("/home");

  return (
    <div className="mx-auto max-w-[1680px] space-y-8 px-3 py-4 md:px-6 md:py-6">
      {/* Bố cục theo bản vẽ tay của mockup: 3 ô | khối nổi bật | bình luận nổi bật */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.1fr)_minmax(280px,1fr)]">
        <div className="lg:order-2">{home.featured && <FeaturedHero media={home.featured} />}</div>

        <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 [scrollbar-width:none] lg:order-1 lg:mx-0 lg:grid lg:grid-rows-3 lg:overflow-visible lg:px-0">
          {home.latest.map((m) => (
            <div key={m.id} className="w-[72%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
              <MediaTile media={m} />
            </div>
          ))}
        </div>

        {/* Màn ≥ 1280px: cao bằng khối nổi bật, cuộn bên trong */}
        <div className="lg:order-3 lg:col-span-2 xl:col-span-1 xl:max-h-[560px]">
          <HotComments top={home.hot_comments.top} replied={home.hot_comments.replied} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Đang được xem nhiều</h2>
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
          {home.trending.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      </section>

      {/* Hàng dưới của mockup: Nghe nhiều | Kinh doanh | Tiện ích (Phần 10) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Nghe nhiều" icon="sound" moreHref="/nghe?sort=popular">
          <RankList items={home.top_listen} />
        </Panel>
        <Panel title="Kinh doanh" icon="briefcase" moreHref="/kinh-doanh?sort=bestseller">
          <ProductMiniList items={home.shop} />
        </Panel>
      </section>
    </div>
  );
}
