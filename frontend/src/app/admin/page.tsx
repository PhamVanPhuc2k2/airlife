import { redirect } from "next/navigation";

// /admin: trang tổng quan nằm ở /admin/tong-quan để mọi mục đều là [section]
export default function Page() {
  redirect("/admin/tong-quan");
}
