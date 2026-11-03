import { redirect } from "next/navigation";

// /tien-ich không có nội dung riêng: mở tab đầu tiên
export default function Page() {
  redirect("/tien-ich/ra-tau-bay");
}
