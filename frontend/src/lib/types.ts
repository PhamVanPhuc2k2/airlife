// Kiểu dữ liệu API trả về. Khớp với DTO bên Go (backend/internal/media/dto.go,
// internal/category, internal/home). Đổi bên Go thì sửa ở đây.

export type Category = {
  slug: string;
  name: string;
  icon: string;
  title: string;
  description: string;
  filters?: { slug: string; name: string }[];
};

export type Channel = {
  slug: string;
  name: string;
  verified: boolean;
  followers_count?: number;
};

export type MediaCard = {
  id: string;
  slug: string;
  kind: "video" | "audio";
  category: string;
  title: string;
  description?: string;
  group_label: string;
  genre_label: string;
  youtube_id: string | null;
  thumbnail_url: string;
  duration_seconds: number | null;
  episode_count: number | null;
  view_count: number;
  featured: boolean;
  published_at: string;
  channel: Channel;
};

export type MediaDetail = MediaCard & {
  tags: string[];
  category_name: string;
  lineup_month: string | null;
};

export type MediaPage = {
  items: MediaCard[];
  next_cursor?: string;
};

export type Home = {
  featured: MediaCard | null;
  latest: MediaCard[];
  trending: MediaCard[];
  top_listen: MediaCard[];
  hot_comments: { top: HotComment[]; replied: HotComment[] };
  shop: ProductCard[];
};

export type NewsCategory = {
  slug: string;
  name: string;
  description: string;
};

export type NewsCard = {
  id: string;
  slug: string;
  category: string;
  category_name: string;
  title: string;
  excerpt: string;
  cover_url: string;
  author: string;
  published_at: string;
};

// body_html đã được backend lọc bằng bluemonday trước khi lưu (backend/pkg/sanitize)
export type Article = NewsCard & {
  body_html: string;
  updated_at: string;
};

export type NewsPage = {
  items: NewsCard[];
  next_cursor?: string;
};

// Tài khoản đang đăng nhập (GET /auth/me). Khớp backend/internal/auth/service.go: User
export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: "user" | "creator" | "business" | "editor" | "admin";
  email_verified: boolean;
  created_at: string;
};

// Trang kênh (GET /channels/{slug}). following: người đang xem có theo dõi không
export type ChannelDetail = {
  slug: string;
  name: string;
  type: "distributor" | "creator" | "business" | "travel";
  verified: boolean;
  followers_count: number;
  description: string;
  avatar_url: string | null;
  media_count: number;
  following: boolean;
};

// Kênh trong danh sách "Kênh đang theo dõi" (GET /me/following)
export type ChannelBrief = {
  slug: string;
  name: string;
  type: ChannelDetail["type"];
  verified: boolean;
  followers_count: number;
  avatar_url: string | null;
};

export type Comment = {
  id: string;
  author: { id: string; display_name: string; avatar_url: string | null };
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  liked_by_me: boolean;
  mine: boolean;
};

export type CommentPage = { items: Comment[]; next_cursor?: string };

export type HotComment = Comment & { media: { slug: string; category: string; title: string } };

// Thư viện cá nhân (Phần 06) ------------------------------------------------------------------

// Đã xem tới giây thứ position trên tổng duration giây
export type Progress = { position: number; duration: number };

// Media trong thư viện. progress chỉ có ở lịch sử xem / tiếp tục xem
export type LibraryItem = MediaCard & { progress?: Progress };

export type LibraryPage = { items: LibraryItem[]; next_cursor?: string };

// GET /me/media/{slug}: trạng thái của một media với người đang xem
export type MediaState = { saved: boolean; progress: Progress | null; playlist_ids: string[] };

export type LibraryStats = {
  following: number;
  saved: number;
  playlists: number;
  watched: number;
  orders: number;
};

export type Playlist = {
  id: string;
  name: string;
  item_count: number;
  updated_at: string;
  first?: { slug: string; category: string; thumbnail_url: string };
};

export type PlaylistDetail = Playlist & { items: LibraryItem[] };

// Bán hàng (Phần 07) ---------------------------------------------------------------------------
// Tiền là số nguyên, đơn vị đồng (389000 = 389.000₫)

export type DeliveryMethod = "gate" | "arrival" | "home" | "evoucher";

export type ProductCard = {
  id: string;
  slug: string;
  kind: "goods" | "booking"; // booking: vé bay, tour (đặt chỗ ở Phần 08)
  category: string;
  tag: string;
  tag_name: string;
  name: string;
  description: string;
  image_url: string;
  price: number; // giá thấp nhất ("từ")
  old_price: number | null;
  rating: number;
  rating_count: number;
  sold_count: number;
  published_at: string;
  channel: {
    slug: string;
    name: string;
    verified: boolean;
    type?: string;
    followers_count?: number;
  };
};

export type ProductVariant = {
  id: string;
  label: string;
  price: number;
  old_price: number | null;
  stock: number;
};

export type ProductDetail = ProductCard & {
  category_name: string;
  body_html: string;
  gallery: string[];
  delivery_methods: DeliveryMethod[];
  variants: ProductVariant[];
  media: MediaCard[];
  related: ProductCard[];
};

export type ProductPage = { items: ProductCard[]; next_cursor?: string };

export type CartLine = {
  variant_id: string;
  quantity: number;
  label: string;
  price: number;
  old_price: number | null;
  stock: number;
  product: { slug: string; name: string; image_url: string; channel_name: string };
  delivery_methods: DeliveryMethod[];
  problem?: "unavailable" | "out_of_stock" | "low_stock";
};

export type Cart = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  delivery_methods: DeliveryMethod[]; // cách nhận dùng được cho cả giỏ
  ready: boolean;
};

export type OrderStatus = "pending" | "confirmed" | "delivering" | "completed" | "cancelled";

export type Order = {
  code: string;
  status: OrderStatus;
  payment_method: "cod";
  delivery_method: DeliveryMethod;
  recipient_name: string;
  phone: string;
  flight_code: string | null;
  flight_date: string | null;
  address: string | null;
  note: string;
  subtotal: number;
  shipping_fee: number;
  total: number;
  created_at: string;
  cancelled_at: string | null;
  items: {
    product_slug: string;
    product_name: string;
    variant_label: string;
    image_url: string;
    unit_price: number;
    quantity: number;
    line_total: number;
  }[];
};

export type OrderSummary = {
  code: string;
  status: OrderStatus;
  delivery_method: DeliveryMethod;
  total: number;
  created_at: string;
  first_name: string;
  first_image: string;
  item_count: number;
};

export type OrderPage = { items: OrderSummary[]; next_cursor?: string };
