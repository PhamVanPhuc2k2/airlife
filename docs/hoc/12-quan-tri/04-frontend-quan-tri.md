# Bài 12.04: Frontend quản trị và nghiệm thu

> [← Bài trước](03-don-hang-hoan-tien-nguoi-dung.md) · [Mục lục](../README.md)

## Mục tiêu

Dựng `/admin/[section]` với 8 mục, ẩn mục theo vai trò, và thử toàn bộ bằng curl và trình duyệt.

## Bạn sẽ học

- Chặn truy cập hai lớp: giao diện chỉ để **ẩn menu và báo rõ lý do**, API mới là nơi chặn thật.
- Khung danh sách dùng lại cho mọi mục (`kit.tsx`: lọc, phân trang, nút, lỗi).
- Key cache bắt đầu bằng `["me","admin"]` để đăng xuất xoá sạch dữ liệu quản trị.
- Thêm `robots: noindex` cho khu quản trị.

## Viết code

- [frontend/src/lib/admin-sections.ts](../../../frontend/src/lib/admin-sections.ts): danh sách mục và vai trò được vào.
- [frontend/src/lib/admin.ts](../../../frontend/src/lib/admin.ts): kiểu dữ liệu, `useAdminList` (giữ trang cũ khi tải trang mới), `useAdminAction` (ghi rồi tải lại mọi danh sách quản trị).
- [frontend/src/components/admin/](../../../frontend/src/components/admin/): `AdminShell` (kiểm tra vai trò, menu), `Moderation`, `SurveysAdmin`, `Commerce` (đơn hàng, hoàn tiền, người dùng), `Overview`.
- Trang: `frontend/src/app/admin/[section]/page.tsx`

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { OrdersAdmin, RefundsAdmin, UsersAdmin } from "@/components/admin/Commerce";
import { CommentsAdmin, ExperiencesAdmin, FeedbacksAdmin } from "@/components/admin/Moderation";
import { Overview } from "@/components/admin/Overview";
import { SurveysAdmin } from "@/components/admin/SurveysAdmin";
import { PageHead } from "@/components/ui/PageHead";
import { SECTIONS } from "@/lib/admin-sections";

type Props = { params: Promise<{ section: string }> };

// Khu quản trị không cho công cụ tìm kiếm lập chỉ mục
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  const s = SECTIONS.find((x) => x.key === section);
  return { title: `${s?.label ?? "Quản trị"} · Quản trị`, robots: { index: false, follow: false } };
}

// Toàn bộ dữ liệu quản trị lấy ở trình duyệt (cần cookie đăng nhập, không cache, không prefetch).
export default async function Page({ params }: Props) {
  const { section } = await params;
  if (!SECTIONS.some((s) => s.key === section)) notFound();
  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="radar"
        title="Quản trị"
        desc="Kiểm duyệt nội dung, xử lý đơn hàng, hoàn tiền và quản lý người dùng."
      />
      <AdminShell section={section}>
        {section === "tong-quan" && <Overview />}
        {section === "binh-luan" && <CommentsAdmin />}
        {section === "trai-nghiem" && <ExperiencesAdmin />}
        {section === "gop-y" && <FeedbacksAdmin />}
        {section === "khao-sat" && <SurveysAdmin />}
        {section === "don-hang" && <OrdersAdmin />}
        {section === "hoan-tien" && <RefundsAdmin />}
        {section === "nguoi-dung" && <UsersAdmin />}
      </AdminShell>
    </div>
  );
}
```

Editor không có "Tổng quan": `AdminShell` chuyển thẳng tới `/admin/binh-luan`. Menu tài khoản có mục "Quản trị" cho `editor`/`admin`.

## Kiểm tra

```bash
make migrate
make fe-lint && make fe-typecheck
# đặt vai trò (dev): update users set role='admin' where email='…'
```

Các tình huống đã thử bằng curl:

| Tình huống | Kết quả |
|---|---|
| Chưa đăng nhập vào `/admin/stats` | 401 |
| `user` thường vào `/admin/comments` | 403 |
| `editor` vào `/admin/stats` | 403; vào `/admin/comments` 200 |
| Ẩn bình luận con | 204; `reply_count` 1 → 0; hiện lại → 1 |
| Trạng thái lạ (`deleted`) | 400 `invalid_status` |
| Đơn `pending` → `completed` | 409 `invalid_transition` |
| Đơn `pending` → `cancelled` | 204, kho 8 → 10 |
| Đơn đã huỷ → `confirmed` | 409 |
| Hoàn tiền thiếu ghi chú | 400, báo ô `note` |
| Hoàn tiền lần hai | 409 `not_refundable` |
| Admin tự đổi vai trò mình | 403 `self_change` |
| Vai trò lạ | 400 `invalid_role` |
| Khoá người dùng | 204; `/auth/refresh` 401; đăng nhập `account_locked` |
| `editor` đổi người dùng | 403 |

Trình duyệt (1440 px và 390 px): khách và user thường thấy thông báo không đủ quyền, admin thấy đủ 8 mục, editor chỉ thấy 4 mục và `/admin/tong-quan` tự chuyển sang bình luận; ẩn bình luận, xác nhận đơn, hoàn tiền (thiếu ghi chú báo lỗi rồi thành công) đều chạy; không cuộn ngang; console sạch.

## Hay gặp lỗi

- **Trang `/admin/...` lỗi 500 "Uncaught" ở server, console báo `Page`**: `SECTIONS` ban đầu nằm trong file có `"use client"`. Khi import từ **server component**, export của file client chỉ là một tham chiếu, không phải mảng thật, nên `SECTIONS.some(...)` nổ. Dữ liệu dùng cả hai phía phải để ở file thường (`lib/admin-sections.ts`).
- **Vẫn thấy dữ liệu admin sau khi đăng xuất**: key cache không bắt đầu bằng `"me"`, nên `useLogout` không xoá.
- **Kết quả thử cũ còn trong trình duyệt headless** (đã đăng nhập sẵn từ lần trước): kiểm tra "khách" cho kết quả sai; dùng hồ sơ trình duyệt mới hoặc xoá cookie trước.
