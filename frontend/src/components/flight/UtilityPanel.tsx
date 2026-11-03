import Link from "next/link";

import { Icon, type IconName } from "@/components/icons/Icon";
import { Panel } from "@/components/ui/Panel";
import type { Flight } from "@/lib/types";

import { FlightRow } from "./FlightRow";

const SHORTCUTS: { href: string; icon: IconName; label: string }[] = [
  { href: "/tien-ich/ra-tau-bay", icon: "luggage", label: "Ra tàu bay" },
  { href: "/tien-ich/thoi-tiet", icon: "sun", label: "Thời tiết" },
  { href: "/tien-ich/wifi", icon: "wifi", label: "Wi-Fi" },
  { href: "/tien-ich/phong-cho", icon: "gate", label: "Phòng chờ" },
];

// Khối "Tiện ích" ở trang chủ: tra cứu chuyến bay, vài chuyến đang bay, lối tắt tới các tab
export function UtilityPanel({ flights }: { flights: Flight[] }) {
  return (
    <Panel title="Tiện ích" icon="radar" moreHref="/tien-ich">
      {/* GET /tien-ich/flightradar?q=VN220: form thường, không cần JavaScript */}
      <form action="/tien-ich/flightradar" className="mb-3 flex gap-2">
        <input
          type="search"
          name="q"
          maxLength={40}
          placeholder="Số hiệu chuyến bay, VD: VN 220"
          aria-label="Số hiệu chuyến bay"
          className="h-10 min-w-0 flex-1 rounded-full bg-surface-2 px-4 text-sm ring-1 ring-ink/[0.1] focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <button
          type="submit"
          className="h-10 shrink-0 rounded-full bg-gradient-brand px-4 text-sm font-semibold text-white"
        >
          Tra cứu
        </button>
      </form>
      {flights.length > 0 ? (
        <div className="divide-y divide-ink/[0.07]">
          {flights.map((f) => (
            <FlightRow key={f.code} f={f} />
          ))}
        </div>
      ) : (
        <p className="py-2 text-sm text-ink-muted">Hiện không có chuyến nào đang bay.</p>
      )}
      <ul className="mt-3 grid grid-cols-4 gap-2">
        {SHORTCUTS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex flex-col items-center gap-1 rounded-card-sm bg-surface-2 py-3 text-xs font-semibold hover:bg-brand-50 hover:text-brand-700"
            >
              <Icon name={s.icon} className="size-5 text-brand-600" />
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
