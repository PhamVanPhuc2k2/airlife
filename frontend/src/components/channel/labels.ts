import type { ChannelDetail } from "@/lib/types";

// Tên loại kênh (trang kênh, danh sách kênh đang theo dõi ở trang Bạn)
export const CHANNEL_TYPE_LABEL: Record<ChannelDetail["type"], string> = {
  distributor: "Nhà phân phối nội dung",
  creator: "Nhà sáng tạo",
  business: "Doanh nghiệp",
  travel: "Doanh nghiệp lữ hành",
};
