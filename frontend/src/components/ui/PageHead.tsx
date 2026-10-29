import { Icon, type IconName } from "@/components/icons/Icon";

// Đầu trang: icon trong ô gradient, tiêu đề, mô tả (mockup: pageHead()).
export function PageHead({ icon, title, desc }: { icon: IconName; title: string; desc: string }) {
  return (
    <header className="flex items-start gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-card-sm bg-gradient-brand text-white shadow-brand">
        <Icon name={icon} className="size-6" />
      </span>
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-ink-muted">{desc}</p>
      </div>
    </header>
  );
}
