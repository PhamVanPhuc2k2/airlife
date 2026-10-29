# Bài 2.08: Gọi API từ Next.js

> [← Bài trước](07-trang-chu-va-noi-day.md) · [Mục lục](../README.md) · [Bài sau →](09-tanstack-query.md)

## Mục tiêu

Hàm `api<T>()` gọi backend từ cả server component lẫn trình duyệt, đổi lỗi API thành `ApiError`.
Kiểu dữ liệu TypeScript khớp với DTO bên Go. Hàm định dạng số và thời gian kiểu Việt Nam.

## Bạn sẽ học

- Vì sao cùng một API mà server và trình duyệt phải dùng **hai địa chỉ** khác nhau.
- Biến `NEXT_PUBLIC_*` khác biến môi trường thường thế nào.
- Bọc `fetch` một lần để mọi chỗ xử lý lỗi giống nhau.

## Viết code

### Bước 1: Hai địa chỉ API

```text
Trình duyệt (máy bạn) ──► localhost:8080 ──► container api
Server Next.js (container frontend) ──► api:8080 (tên service trong mạng Docker) ──► container api
```

Trong container frontend, `localhost` là **chính container frontend**, không có API ở đó. Ngược
lại, trình duyệt không biết tên `api`. Thêm vào khối `environment` của `frontend` trong
`docker-compose.yml`:

```yaml
      # Địa chỉ API mà SERVER Next.js (trong container này) gọi tới: tên service trong mạng Docker
      API_INTERNAL_URL: http://api:8080
```

- **`NEXT_PUBLIC_API_URL`**: Next.js **chép giá trị vào JavaScript** gửi cho trình duyệt. Ai mở
  DevTools cũng đọc được, nên chỉ để những thứ công khai.
- **`API_INTERNAL_URL`** (không có tiền tố): chỉ code chạy trên server đọc được.

Tạo lại container để nhận biến mới: `docker compose up -d frontend`.

Dữ liệu mẫu dùng ảnh picsum.photos; cho phép trong `frontend/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gói gọn server + thư viện cần thiết vào .next/standalone để image production nhỏ.
  output: "standalone",
  // Không gửi header "X-Powered-By: Next.js": không cần cho kẻ tấn công biết dùng gì.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Thumbnail video YouTube
      { protocol: "https", hostname: "i.ytimg.com" },
      // Ảnh minh hoạ của dữ liệu mẫu (cmd/seed). Bỏ khi đã có ảnh thật.
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;
```

### Bước 2: `frontend/src/lib/api.ts`

```ts
// Gọi API backend. Dùng được ở cả server component lẫn client component.
//
// Hai địa chỉ khác nhau cho cùng một API:
//   - Trên server (container frontend): gọi thẳng service `api` trong mạng Docker, không đi vòng
//     ra ngoài máy.
//   - Trên trình duyệt: trình duyệt nằm trên máy người dùng, chỉ biết cổng API mở ra ngoài.
const API_URL =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? "http://localhost:8080")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080");

// Lỗi từ API, đúng khuôn {"error": {"code", "message", "request_id"}} của backend (pkg/response).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = {
  data?: T;
  error?: { code: string; message: string; request_id?: string };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    // Dữ liệu đã được backend cache bằng Redis; Next.js không cache thêm lớp nữa
    cache: "no-store",
    headers: { Accept: "application/json", ...init?.headers },
  });

  if (res.status === 204) return undefined as T;

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, "bad_response", "Máy chủ trả dữ liệu không hợp lệ");
  }
  if (!res.ok || body.error) {
    throw new ApiError(
      res.status,
      body.error?.code ?? "unknown",
      body.error?.message ?? "Có lỗi xảy ra, vui lòng thử lại sau",
      body.error?.request_id,
    );
  }
  return body.data as T;
}

// Ghép query string, bỏ qua tham số rỗng: qs({ a: "x", b: undefined }) → "a=x"
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
}
```

- **`typeof window === "undefined"`**: đang chạy trên server (không có `window`) hay trình duyệt.
- **`cache: "no-store"`**: backend đã cache bằng Redis; thêm lớp cache của Next.js thì khó biết dữ
  liệu cũ nằm ở lớp nào.
- **`ApiError`** giữ `status`, `code`, `requestId`: trang xem dùng `status === 404` để hiện trang 404;
  báo lỗi cho người dùng thì kèm `requestId` để tra log (bài 0.05).

### Bước 3: `frontend/src/lib/types.ts`

```ts
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
};
```

Tên trường giữ **snake_case** như JSON của Go (`view_count`), không đổi sang camelCase: đọc JSON trong
DevTools và đọc code thấy cùng một tên.

### Bước 4: `frontend/src/lib/format.ts`

```ts
// Định dạng số, thời lượng, thời gian kiểu Việt Nam (giống mockup: "1,8 Tr", "54,2 N").

// 1840000 → "1,8 Tr"; 54200 → "54,2 N"; 980 → "980"
export function compactNumber(n: number): string {
  const fmt = (x: number) => x.toFixed(1).replace(".", ",").replace(",0", "");
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)} Tr`;
  if (n >= 1_000) return `${fmt(n / 1_000)} N`;
  return String(n);
}

// 7694 → "2:08:14"; 492 → "8:12"
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Nhãn thời lượng trên thẻ: phim lẻ "2:08:14", series "10 tập"
export function durationLabel(m: {
  duration_seconds: number | null;
  episode_count: number | null;
}): string {
  if (m.episode_count) return `${m.episode_count} tập`;
  if (m.duration_seconds) return formatDuration(m.duration_seconds);
  return "";
}

// "2 ngày trước", "3 tuần trước"…
export function timeAgo(iso: string, now: number = Date.now()): string {
  const sec = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const steps: [number, string][] = [
    [60, "giây"],
    [60, "phút"],
    [24, "giờ"],
    [7, "ngày"],
    [4.35, "tuần"],
    [12, "tháng"],
  ];
  let value = sec;
  for (const [size, unit] of steps) {
    if (value < size) {
      return unit === "giây" ? "vừa xong" : `${Math.floor(value)} ${unit} trước`;
    }
    value /= size;
  }
  return `${Math.floor(value)} năm trước`;
}
```

`timeAgo` đổi lần lượt giây → phút → giờ → ngày → tuần → tháng → năm, dừng ở đơn vị đầu tiên còn nhỏ
hơn ngưỡng.

## Kiểm tra

```bash
make fe-typecheck && make fe-lint
docker compose exec frontend sh -c 'wget -qO- $API_INTERNAL_URL/api/v1/ping'
# {"data":{"message":"pong"}}   ← container frontend gọi được api bằng tên service
```

```bash
git add . && git commit -m "Gọi API từ Next.js"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Server component báo `fetch failed ... ECONNREFUSED 127.0.0.1:8080` | Server đang gọi `localhost`. Thiếu `API_INTERNAL_URL`, hoặc chưa tạo lại container |
| `process.env.API_INTERNAL_URL` là `undefined` ở client component | Đúng như thiết kế: biến không có `NEXT_PUBLIC_` không bao giờ tới trình duyệt |
| `Invalid src prop ... hostname "picsum.photos" is not configured` | Thiếu `remotePatterns` trong `next.config.ts` |
