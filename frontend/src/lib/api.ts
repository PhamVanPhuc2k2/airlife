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
