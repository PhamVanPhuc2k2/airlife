import Link from "next/link";

// Trang 404, hiện bên trong khung chung (header, menu vẫn còn).
// Giai đoạn đầu, nhiều mục menu chưa có trang: khách bấm vào sẽ thấy trang này.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
      <img src="/brand/airlife-mark.svg" alt="" className="size-24 opacity-80" />
      <h1 className="mt-6 text-2xl font-bold">Không tìm thấy trang</h1>
      <p className="mt-2 text-ink-muted">
        Trang này không tồn tại hoặc đang được xây dựng. Bạn quay lại trang chủ nhé.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-brand-600 px-6 py-2.5 font-semibold text-white shadow-brand transition hover:bg-brand-700"
      >
        Về trang chủ
      </Link>
    </div>
  );
}
