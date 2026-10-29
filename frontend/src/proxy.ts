import { type NextRequest, NextResponse } from "next/server";

// proxy.ts (Next.js 16; trước đây là middleware.ts): chạy TRƯỚC khi dựng trang.
// Trang cần đăng nhập mà không có cookie al_session → chuyển tới trang đăng nhập, kèm ?next= để
// đăng nhập xong quay lại đúng trang.
//
// Đây chỉ là lớp tiện lợi cho người dùng, KHÔNG phải lớp bảo mật: cookie al_session ai cũng tự
// tạo được. Bảo mật thật nằm ở API (RequireAuth kiểm tra access token).
export function proxy(request: NextRequest) {
  if (request.cookies.has("al_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/dang-nhap";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

// Chỉ chạy cho các trang cần đăng nhập
export const config = {
  matcher: ["/ban/:path*", "/suu-tap/:path*", "/thanh-toan", "/don-hang/:path*", "/dat-cho/:path*"],
};
