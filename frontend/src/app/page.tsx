// Trang tạm: kiểm tra logo, font và theme Tailwind. Bài layout sẽ thay bằng trang chủ thật.
const swatches = [
  { name: "brand-600", className: "bg-brand-600 text-white" },
  { name: "brand-300", className: "bg-brand-300 text-ink" },
  { name: "accent-700", className: "bg-accent-700 text-white" },
  { name: "accent-light", className: "bg-accent-light text-ink" },
  { name: "surface-2", className: "bg-surface-2 text-ink" },
  { name: "overlay", className: "bg-overlay text-white" },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh, không cần tối ưu ảnh */}
      <img
        src="/brand/airlife-logo.svg"
        alt="Airlife – Đời sống hàng không"
        className="h-24 w-auto"
      />

      <section className="space-y-2">
        <h1 className="text-3xl font-bold">Đời sống hàng không</h1>
        <p className="text-ink-muted">
          Font Be Vietnam Pro: ă â đ ê ô ơ ư — Ấ Ầ Ẩ Ẫ Ậ — Phở Hà Nội, Đà Lạt, Huế.
        </p>
        <p className="text-lg font-semibold text-accent-700">1.590.000₫</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {swatches.map((s) => (
          <div
            key={s.name}
            className={`rounded-card p-4 text-sm font-medium shadow-sm ${s.className}`}
          >
            {s.name}
          </div>
        ))}
        <div className="col-span-2 rounded-card bg-gradient-accent p-4 text-sm font-medium text-white sm:col-span-3">
          gradient-accent
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button className="rounded-card-sm bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-brand transition hover:bg-brand-700">
          Xem ngay
        </button>
        <button className="rounded-card-sm bg-accent-700 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-800">
          Mua ngay
        </button>
      </div>

      <div className="rounded-card bg-overlay p-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
        <img src="/brand/airlife-logo-white.svg" alt="Airlife" className="h-16 w-auto" />
      </div>
    </main>
  );
}
