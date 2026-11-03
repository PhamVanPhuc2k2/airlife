# Bài 10.06: Frontend tiện ích: Flightradar, ra tàu bay, thời tiết, Wi-Fi; nghiệm thu Phần 10

> [← Bài trước](05-thu-api.md) · [Mục lục](../README.md)

## Mục tiêu

Trang `/tien-ich/[tab]` với 5 tab, khối Tiện ích ở trang chủ, và thẻ chuyến bay sắp tới ở trang Bạn.

## Bạn sẽ học

- Bản đồ **Leaflet** trong Next.js: component chỉ chạy ở trình duyệt (`dynamic` với `ssr: false`), dọn dẹp bản đồ khi gỡ component.
- Tab là **đường dẫn** (`/tien-ich/flightradar?q=VN220`), dán link là mở đúng tab và đúng tìm kiếm.
- `refetchInterval` để bảng chuyến bay tự làm mới.
- Hiển thị lỗi theo từng ô của form từ `fields` mà API trả.

## Viết code

### Bước 1: Cài Leaflet

```bash
make npm c="install --save-exact leaflet@1.9.4"
make npm c="install --save-exact --save-dev @types/leaflet"
docker compose restart frontend     # dev server cần khởi động lại sau khi thêm thư viện
```

### Bước 2: Kiểu dữ liệu và truy vấn

Thêm vào `frontend/src/lib/types.ts` các kiểu `Flight`, `MyFlight`, `Airport`, `WeatherReport`, `WifiPlan`, `Home.flights`
(khớp JSON của backend). `frontend/src/lib/queries.ts` thêm `flightsOptions(q)` (tự lấy lại mỗi 30 giây), `myFlightsOptions()` (60 giây),
`weatherOptions()`, `wifiPlansOptions()`. Nhãn trạng thái, nhãn hạng ghế, màu thời tiết nằm ở `frontend/src/lib/flights.ts`.

`frontend/src/lib/geo.ts` là bản TypeScript của phép nội suy cung tròn lớn ở backend, dùng để vẽ **đường bay** (backend chỉ trả vị trí máy bay):

```ts
// Đường bay trên bản đồ: máy bay đi theo đường ngắn nhất trên mặt cầu (cung tròn lớn), nên nối hai
// sân bay bằng đường thẳng trên bản đồ phẳng là sai, nhất là chặng dài (Hà Nội – Tokyo).
// Cùng công thức với backend (internal/flight/geo.go): nội suy cầu giữa hai vector đơn vị.

const RAD = Math.PI / 180;

function toVec(lat: number, lon: number): [number, number, number] {
  return [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
    Math.sin(lat * RAD),
  ];
}

// Trả về `steps + 1` điểm [lat, lon] nối (lat1, lon1) với (lat2, lon2)
export function greatCircle(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  steps = 48,
): [number, number][] {
  const a = toVec(lat1, lon1);
  const b = toVec(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [[lat1, lon1]];
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ka = Math.sin((1 - t) * omega) / Math.sin(omega);
    const kb = Math.sin(t * omega) / Math.sin(omega);
    const x = ka * a[0] + kb * b[0];
    const y = ka * a[1] + kb * b[1];
    const z = ka * a[2] + kb * b[2];
    pts.push([Math.atan2(z, Math.hypot(x, y)) / RAD, Math.atan2(y, x) / RAD]);
  }
  return pts;
}
```

### Bước 3: Bản đồ, `frontend/src/components/flight/RadarMap.tsx`

```tsx
"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

import { greatCircle } from "@/lib/geo";
import type { Airport, Flight } from "@/lib/types";

// Máy bay nhìn từ trên xuống, mũi hướng lên (bắc); xoay theo hướng bay (heading)
const PLANE_SVG =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="#0ea5e9" stroke="#0c4a6e" stroke-width="1" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c.8 0 1.4.6 1.4 1.4V9l8.1 4.9v2L13.4 13v4.4l2 1.5V21L12 20l-3.4 1v-2.1l2-1.5V13l-8.1 2.9v-2L10.6 9V3.4c0-.8.6-1.4 1.4-1.4z"/></svg>';

type Props = { flights: Flight[] };

// Bản đồ Flightradar: nền OpenStreetMap (Leaflet), sân bay, đường bay cung tròn lớn và máy bay
// đang bay theo vị trí server tính. Chỉ chạy ở trình duyệt (Leaflet cần `window`).
export default function RadarMap({ flights }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  // Tạo bản đồ một lần
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { worldCopyJump: true, zoomControl: true }).setView([14, 108], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      fitted.current = false;
    };
  }, []);

  // Vẽ lại sân bay, đường bay, máy bay mỗi khi dữ liệu mới về (30 giây/lần): ít chuyến nên vẽ lại
  // toàn bộ đơn giản hơn là so sánh từng marker
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();

    const airports = new Map<string, Airport>();
    for (const f of flights) {
      airports.set(f.from.code, f.from);
      airports.set(f.to.code, f.to);
    }

    for (const f of flights) {
      if (f.status !== "in_air" && f.status !== "boarding") continue;
      L.polyline(greatCircle(f.from.lat, f.from.lon, f.to.lat, f.to.lon), {
        color: "#0ea5e9",
        weight: f.status === "in_air" ? 2 : 1,
        opacity: f.status === "in_air" ? 0.7 : 0.35,
        dashArray: f.status === "in_air" ? undefined : "4 6",
      }).addTo(g);
    }
    for (const a of airports.values()) {
      L.circleMarker([a.lat, a.lon], {
        radius: 5,
        color: "#0c4a6e",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      })
        .bindTooltip(`${a.code} · ${a.city}`, { direction: "top" })
        .addTo(g);
    }
    for (const f of flights) {
      if (f.status !== "in_air" || !f.position) continue;
      const icon = L.divIcon({
        className: "",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div style="transform:rotate(${f.position.heading}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">${PLANE_SVG}</div>`,
      });
      L.marker([f.position.lat, f.position.lon], { icon, title: f.code, keyboard: false })
        .bindTooltip(`${f.code} · ${f.from.code} → ${f.to.code}`, {
          direction: "top",
          offset: [0, -10],
        })
        .addTo(g);
    }

    // Lần đầu có dữ liệu thì thu phóng vừa các sân bay; các lần sau giữ nguyên chỗ người dùng đang xem
    if (!fitted.current && airports.size > 0) {
      m.fitBounds(L.latLngBounds([...airports.values()].map((a) => [a.lat, a.lon])), {
        padding: [30, 30],
        maxZoom: 6,
      });
      fitted.current = true;
    }
  }, [flights]);

  return (
    <div
      ref={host}
      role="img"
      aria-label="Bản đồ các chuyến bay đang bay. Danh sách chuyến bay ở bên cạnh."
      className="z-0 h-[360px] w-full overflow-hidden rounded-card ring-1 ring-ink/[0.07] md:h-[520px]"
    />
  );
}
```

- Hai `useEffect`: một tạo bản đồ **một lần** (và `map.remove()` khi gỡ, không thì chuyển trang qua lại sẽ lỗi "Map container is already initialized"),
  một vẽ lại sân bay, đường bay, máy bay mỗi khi dữ liệu đổi.
- Máy bay là `L.divIcon` chứa SVG xoay theo `heading`; không dùng icon mặc định của Leaflet (cần ảnh, hay vỡ đường dẫn khi bundle).
- `fitBounds` chỉ chạy lần đầu để lần làm mới 30 giây không giật bản đồ về chỗ cũ khi người dùng đang kéo.
- Nền bản đồ: OpenStreetMap, bắt buộc ghi nguồn (`attribution`). Máy chủ ô bản đồ miễn phí của OSM giới hạn lượng dùng; khi có nhiều người
  dùng thật cần nhà cung cấp ô bản đồ riêng (MapTiler, Stadia…): chỉ đổi URL trong `tileLayer`.

### Bước 4: Bảng chuyến bay, `FlightBoard.tsx` và `FlightRow.tsx`

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";

import { flightsOptions } from "@/lib/queries";

import { FlightRow } from "./FlightRow";

// Leaflet dùng `window` nên chỉ tải và chạy ở trình duyệt (ssr: false)
const RadarMap = dynamic(() => import("./RadarMap"), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-card bg-surface-2 md:h-[520px]" />,
});

// Tab Flightradar: bản đồ + bảng chuyến bay, tự làm mới mỗi 30 giây
export function FlightBoard({ q }: { q: string }) {
  const { data, isPending, isError } = useQuery(flightsOptions(q));
  const flights = data ?? [];
  const inAir = flights.filter((f) => f.status === "in_air").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="relative">
        <RadarMap flights={flights} />
        <span className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-surface/95 px-3 py-1 text-xs font-semibold shadow-sm">
          <i className="size-2 animate-pulse rounded-full bg-success" />
          Trực tiếp · {inAir} chuyến đang bay
        </span>
      </div>

      <section className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] lg:max-h-[520px] lg:overflow-y-auto">
        <h2 className="mb-2 text-lg font-bold">Bảng chuyến bay</h2>
        {isPending ? (
          <div className="h-40 animate-pulse rounded-card-sm bg-surface-2" />
        ) : isError ? (
          <p className="text-danger">Không tải được bảng chuyến bay. Vui lòng thử lại.</p>
        ) : flights.length === 0 ? (
          <p className="text-ink-muted">
            {q ? `Không có chuyến bay nào khớp “${q}”.` : "Hiện chưa có chuyến bay."}
          </p>
        ) : (
          <div className="divide-y divide-ink/[0.07]">
            {flights.map((f) => (
              <FlightRow key={f.code} f={f} />
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-dim">
          Giờ theo giờ địa phương của từng sân bay. Dữ liệu mô phỏng theo lịch bay mẫu.
        </p>
      </section>
    </div>
  );
}
```

```tsx
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { flightStatus } from "@/lib/flights";
import type { Flight } from "@/lib/types";

// Một dòng chuyến bay: số hiệu, chặng, giờ (địa phương từng sân bay), trạng thái.
// Dùng ở bảng chuyến bay (Flightradar) và khối Tiện ích trên trang chủ.
export function FlightRow({ f }: { f: Flight }) {
  const s = flightStatus(f);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5">
      <strong className="text-sm">{f.code}</strong>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        {f.from.code}
        <Icon name="plane" className="size-4 shrink-0 rotate-90 text-brand-600" />
        {f.to.code}
      </span>
      <span
        className={cn("justify-self-end rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone)}
      >
        {s.label}
      </span>
      <span className="col-span-3 truncate text-xs text-ink-muted">
        {f.dep} – {f.arr}
        {f.arr_next_day && <sup className="ml-0.5 font-semibold">+1</sup>} · {f.from.city} →{" "}
        {f.to.city}
      </span>
    </div>
  );
}
```

`dynamic(() => import("./RadarMap"), { ssr: false })`: Leaflet đụng `window` ngay khi import, nên không được chạy trên server.
Trong lúc tải, hiện khung xám cùng chiều cao để trang không nhảy.

### Bước 5: Chuyến bay của tôi và thẻ lên máy bay

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useForm } from "react-hook-form";

import { Icon } from "@/components/icons/Icon";
import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { CABINS, CABIN_LABEL } from "@/lib/flights";
import { myFlightsOptions } from "@/lib/queries";
import type { Cabin } from "@/lib/types";

import { BoardingPass } from "./BoardingPass";

// Chuyến bay của tôi: dữ liệu riêng của người đăng nhập, lấy ở trình duyệt (có cookie).
function useMyFlights() {
  const { me, isLoading } = useMe();
  const q = useQuery({ ...myFlightsOptions(), enabled: !!me });
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/me/flights/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "flights"] }),
  });
  return { me, isLoading, flights: q.data, isPending: q.isPending && !!me, remove };
}

function LoginPrompt() {
  return (
    <p className="rounded-card bg-surface p-6 text-center text-ink-muted shadow-sm ring-1 ring-ink/[0.07]">
      Đăng nhập để thêm chuyến bay và xem thẻ lên máy bay.{" "}
      <Link
        href="/dang-nhap?next=/tien-ich/ra-tau-bay"
        className="font-semibold text-brand-700 hover:underline"
      >
        Đăng nhập
      </Link>
    </p>
  );
}

// Trang Bạn: vài chuyến sắp tới
export function UpcomingFlights({ limit = 2 }: { limit?: number }) {
  const { me, isLoading, flights, isPending, remove } = useMyFlights();
  if (isLoading || isPending)
    return <div className="h-40 animate-pulse rounded-card bg-surface-2" />;
  if (!me) return <LoginPrompt />;
  if (!flights?.length) {
    return (
      <p className="rounded-card bg-surface p-6 text-center text-ink-muted shadow-sm ring-1 ring-ink/[0.07]">
        Chưa có chuyến bay sắp tới.{" "}
        <Link href="/tien-ich/ra-tau-bay" className="font-semibold text-brand-700">
          Thêm chuyến bay
        </Link>
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {flights.slice(0, limit).map((f) => (
        <BoardingPass key={f.id} f={f} onRemove={() => remove.mutate(f.id)} />
      ))}
    </div>
  );
}

// Tab "Ra tàu bay": thẻ lên máy bay, form thêm chuyến, hành lý, lịch trình theo chuyến sắp tới nhất
export function BoardingTab() {
  const { me, isLoading, flights, isPending, remove } = useMyFlights();
  const next = flights?.[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section aria-labelledby="chuyen-cua-ban" className="space-y-4">
          <h2 id="chuyen-cua-ban" className="text-lg font-bold">
            Chuyến bay của bạn
          </h2>
          {isLoading || isPending ? (
            <div className="h-40 animate-pulse rounded-card bg-surface-2" />
          ) : !me ? (
            <LoginPrompt />
          ) : flights?.length ? (
            flights.map((f) => (
              <BoardingPass key={f.id} f={f} onRemove={() => remove.mutate(f.id)} />
            ))
          ) : (
            <p className="rounded-card bg-surface p-5 text-ink-muted shadow-sm ring-1 ring-ink/[0.07]">
              Bạn chưa thêm chuyến bay nào. Nhập số hiệu chuyến bay bên dưới.
            </p>
          )}
          {me && <AddFlightForm />}
        </section>

        <section className="rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
          <h2 className="mb-3 text-lg font-bold">Hành lý</h2>
          <ul className="grid gap-2 text-sm">
            {[
              "Xách tay 7kg, kích thước tối đa 56 × 36 × 23 cm",
              "Ký gửi 30kg (hạng Thương gia)",
              "Chất lỏng dưới 100ml/chai, tổng không quá 1 lít",
              "Pin dự phòng mang theo người, không ký gửi",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Icon name="check" className="mt-0.5 size-4 text-success" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Timeline gate={next?.gate} boarding={next?.boarding} />
    </div>
  );
}

function Timeline({ gate, boarding }: { gate?: string; boarding?: string }) {
  const steps = [
    ["Trước 24 giờ", "Làm thủ tục trực tuyến, chọn ghế và nhận thẻ lên máy bay điện tử."],
    ["Trước 2 giờ", "Có mặt tại sân bay. Chuyến quốc tế nên đến trước 3 giờ."],
    ["Trước 60 phút", "Đóng quầy ký gửi hành lý. Qua soi chiếu an ninh (fast-track nếu đã đặt)."],
    [
      "Trước 40 phút",
      gate && boarding
        ? `Có mặt tại cửa ra máy bay ${gate}. Bắt đầu lên tàu lúc ${boarding}.`
        : "Có mặt tại cửa ra máy bay. Giờ lên tàu hiện trên thẻ lên máy bay.",
    ],
    ["Trước 15 phút", "Đóng cửa ra máy bay. Hành khách đến trễ sẽ không được lên tàu."],
  ];
  return (
    <section className="h-fit rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
      <h2 className="mb-4 text-lg font-bold">Lịch trình ra tàu bay</h2>
      <ol className="space-y-4 border-l-2 border-brand-100 pl-5">
        {steps.map(([t, d]) => (
          <li key={t} className="relative">
            <span className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-brand-500 ring-4 ring-brand-50" />
            <strong>{t}</strong>
            <p className="text-sm text-ink-muted">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Values = { code: string; date: string; seat: string; cabin: Cabin };

function AddFlightForm() {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<Values>({ defaultValues: { code: "", date: "", seat: "", cabin: "economy" } });

  const add = useMutation({
    mutationFn: (v: Values) =>
      api<void>("/me/flights", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: async () => {
      reset();
      await qc.invalidateQueries({ queryKey: ["me", "flights"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    },
  });
  // Lỗi không gắn với ô nào (đã thêm rồi, quá 10 chuyến…)
  const formError = add.error instanceof ApiError && !add.error.fields ? add.error.message : null;

  return (
    <form
      onSubmit={handleSubmit((v) => add.mutate(v))}
      noValidate
      className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-2"
    >
      <h3 className="font-bold sm:col-span-2">Thêm chuyến bay</h3>
      <Field
        label="Số hiệu chuyến bay"
        placeholder="VN 220"
        autoCapitalize="characters"
        error={errors.code?.message}
        {...register("code", { required: "Nhập số hiệu chuyến bay" })}
      />
      <Field
        label="Ngày bay"
        type="date"
        error={errors.date?.message}
        {...register("date", { required: "Chọn ngày bay" })}
      />
      <Field
        label="Số ghế (không bắt buộc)"
        placeholder="3A"
        autoCapitalize="characters"
        error={errors.seat?.message}
        {...register("seat")}
      />
      <div className="grid gap-1.5">
        <label htmlFor="cabin" className="text-sm font-semibold">
          Hạng ghế
        </label>
        <select
          id="cabin"
          className="h-11 rounded-card-sm bg-surface px-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
          {...register("cabin")}
        >
          {CABINS.map((c) => (
            <option key={c} value={c}>
              {CABIN_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={add.isPending}
        className="h-11 rounded-full bg-gradient-brand px-6 font-semibold text-white shadow-brand disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
      >
        {add.isPending ? "Đang thêm…" : "Thêm chuyến bay"}
      </button>
    </form>
  );
}
```

```tsx
import { Icon } from "@/components/icons/Icon";
import { CABIN_LABEL, dayMonthYear, flightStatus } from "@/lib/flights";
import { cn } from "@/lib/cn";
import type { MyFlight } from "@/lib/types";

// Thẻ lên máy bay (mockup: boardingPass()). Giờ là giờ địa phương của từng sân bay.
export function BoardingPass({ f, onRemove }: { f: MyFlight; onRemove?: () => void }) {
  const s = flightStatus(f);
  return (
    <article
      aria-label={`Chuyến bay ${f.code}`}
      className="grid overflow-hidden rounded-card bg-surface shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-[1fr_9rem]"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG tĩnh */}
          <img src="/brand/airlife-logo.svg" alt="Airlife" className="h-7 w-auto" />
          <span className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone)}>
              {s.label}
            </span>
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
              {CABIN_LABEL[f.cabin]}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <strong className="block text-3xl font-bold leading-none">{f.from.code}</strong>
            <small className="text-ink-muted">{f.from.city}</small>
            <b className="mt-1 block text-lg">{f.dep}</b>
          </div>
          <Icon name="plane" className="size-7 rotate-90 text-brand-600" />
          <div className="text-right">
            <strong className="block text-3xl font-bold leading-none">{f.to.code}</strong>
            <small className="text-ink-muted">{f.to.city}</small>
            <b className="mt-1 block text-lg">
              {f.arr}
              {f.arr_next_day && <sup className="ml-0.5 text-xs">+1</sup>}
            </b>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-dashed border-ink/15 pt-4 text-sm sm:grid-cols-5">
          <Info label="Chuyến bay" value={f.code} />
          <Info label="Ngày" value={dayMonthYear(f.date)} />
          <Info label="Cửa ra" value={f.gate || "–"} />
          <Info label="Ghế" value={f.seat || "Chưa có"} />
          <Info label="Lên tàu" value={f.boarding} />
        </dl>
      </div>

      <div className="flex flex-col items-center justify-center gap-2 border-t border-dashed border-ink/15 bg-surface-2/60 p-4 text-center sm:border-l sm:border-t-0">
        <span
          aria-hidden
          className="size-20 rounded-card-sm bg-[repeating-conic-gradient(#0f172a_0_25%,transparent_0_50%)] bg-[length:12px_12px] opacity-80"
        />
        <small className="text-ink-muted">Quét tại cửa ra</small>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-semibold text-danger hover:underline"
          >
            Bỏ chuyến này
          </button>
        )}
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
```

- Dữ liệu riêng của người đăng nhập → lấy ở trình duyệt (`useMe` rồi `enabled: !!me`), giống trang Bạn.
- Form `react-hook-form`: lỗi `fields` từ API được `setError` vào đúng ô; lỗi chung (đã thêm rồi, quá 10 chuyến) hiện ở dòng riêng.
- Ô ngày **không** đặt thuộc tính `min` bằng ngày hôm nay: tính "hôm nay" trong lúc render là không thuần khiết (ESLint chặn), và backend vẫn kiểm tra.

### Bước 6: Thời tiết, Wi-Fi, khối trang chủ

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { WEATHER_TONE } from "@/lib/flights";
import { timeAgo } from "@/lib/format";
import { weatherOptions } from "@/lib/queries";

// Tab Thời tiết điểm đến: thời tiết hiện tại tại các sân bay (Open-Meteo, server cache 30 phút)
export function WeatherGrid() {
  const { data, isPending, isError, refetch } = useQuery(weatherOptions());

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-surface-2" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-card bg-surface p-6 text-center shadow-sm ring-1 ring-ink/[0.07]">
        <p className="text-ink-muted">Chưa lấy được thời tiết. Bạn thử lại sau ít phút nhé.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 font-semibold text-brand-700 hover:underline"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.airports.map((a) => (
          <li
            key={a.code}
            className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-sm ring-1 ring-ink/[0.07]"
          >
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full",
                WEATHER_TONE[a.condition],
              )}
            >
              <Icon name={a.condition} className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate">{a.city}</strong>
              <small className="block text-ink-muted">
                {a.code} · {a.text}
              </small>
              <small className="block text-ink-dim">
                Ẩm {a.humidity}% · gió {Math.round(a.wind_kmh)} km/h
              </small>
            </div>
            <span className="text-2xl font-bold">{Math.round(a.temp_c)}°</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-dim">
        {data.stale && "Không kết nối được nguồn thời tiết, đang hiện dữ liệu đã lưu. "}
        Cập nhật {timeAgo(data.updated_at)} · nguồn{" "}
        <a href="https://open-meteo.com" className="underline" rel="noreferrer">
          Open-Meteo
        </a>
      </p>
    </div>
  );
}
```

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { wifiPlansOptions } from "@/lib/queries";

// Tab Wi-Fi trên máy bay. Gói được mua và kích hoạt ngay trên chuyến bay (mạng AIRLIFE-WIFI), nên ở đây
// chỉ chọn gói và xem hướng dẫn; chưa có thanh toán trên web cho mục này.
export function WifiPlans() {
  const { data, isPending, isError } = useQuery(wifiPlansOptions());
  const [picked, setPicked] = useState<string | null>(null);

  if (isPending) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;
  if (isError)
    return <p className="text-danger">Không tải được các gói Wi-Fi. Vui lòng thử lại.</p>;

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 md:grid-cols-3">
        {data.map((p) => (
          <li
            key={p.id}
            className={cn(
              "relative flex flex-col gap-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]",
              p.popular && "ring-2 ring-brand-500",
            )}
          >
            {p.popular && (
              <span className="absolute right-4 top-4 rounded-full bg-gradient-brand px-2.5 py-0.5 text-xs font-semibold text-white">
                Phổ biến
              </span>
            )}
            <Icon name="wifi" className="size-7 text-brand-600" />
            <h3 className="text-lg font-bold">{p.name}</h3>
            <p className="flex-1 text-sm text-ink-muted">{p.description}</p>
            <div>
              <strong className="text-2xl">{formatPrice(p.price)}</strong>
              <small className="text-ink-muted"> / chặng bay</small>
            </div>
            <button
              type="button"
              onClick={() => setPicked(p.name)}
              className={cn(
                "h-11 rounded-full font-semibold",
                p.popular
                  ? "bg-gradient-brand text-white shadow-brand"
                  : "text-brand-700 ring-1 ring-brand-500 hover:bg-brand-50",
              )}
            >
              Chọn gói
            </button>
          </li>
        ))}
      </ul>
      {picked && (
        <p role="status" className="rounded-card bg-brand-50 p-4 text-brand-800">
          Đã chọn gói <b>{picked}</b>. Trên máy bay, kết nối mạng <b>AIRLIFE-WIFI</b> rồi chọn gói
          này để kích hoạt và thanh toán.
        </p>
      )}
    </div>
  );
}
```

```tsx
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
```

Gói Wi-Fi mua và kích hoạt ngay trên máy bay, nên trang web chỉ cho chọn gói và hiện hướng dẫn kết nối `AIRLIFE-WIFI`. Chưa có thanh toán web cho mục này (ghi trong TASKS).

### Bước 7: Trang `/tien-ich/[tab]`

```tsx
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BoardingTab } from "@/components/flight/MyFlights";
import { FlightBoard } from "@/components/flight/FlightBoard";
import { WeatherGrid } from "@/components/flight/WeatherGrid";
import { WifiPlans } from "@/components/flight/WifiPlans";
import { ProductGrid } from "@/components/product/ProductGrid";
import { PageHead } from "@/components/ui/PageHead";
import { TabLinks } from "@/components/ui/TabLinks";
import { getQueryClient } from "@/lib/query-client";
import { productListOptions } from "@/lib/queries";

const TABS = [
  { key: "ra-tau-bay", label: "Ra tàu bay" },
  { key: "flightradar", label: "Flightradar" },
  { key: "thoi-tiet", label: "Thời tiết điểm đến" },
  { key: "wifi", label: "Wi-Fi trên máy bay" },
  { key: "phong-cho", label: "Phòng chờ & fast-track" },
] as const;

type Props = {
  params: Promise<{ tab: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab } = await params;
  const t = TABS.find((x) => x.key === tab);
  return { title: t ? `${t.label} · Tiện ích` : "Tiện ích" };
}

// Tiện ích (mockup: renderUtility). Mỗi tab là một đường dẫn riêng: /tien-ich/flightradar?q=VN220
// dán cho người khác là mở đúng tab, đúng tìm kiếm.
export default async function Page({ params, searchParams }: Props) {
  const { tab } = await params;
  if (!TABS.some((t) => t.key === tab)) notFound();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 40);

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-3 py-6 md:px-6">
      <PageHead
        icon="radar"
        title="Tiện ích"
        desc="Mọi thứ cần cho chuyến bay: ra tàu bay, theo dõi chuyến bay, thời tiết, Wi-Fi và dịch vụ sân bay."
      />
      <TabLinks
        label="Tiện ích"
        items={TABS.map((t) => ({
          label: t.label,
          href: `/tien-ich/${t.key}`,
          active: t.key === tab,
        }))}
      />
      {tab === "ra-tau-bay" && <BoardingTab />}
      {tab === "flightradar" && (
        <div className="space-y-4">
          <form action="/tien-ich/flightradar" role="search" className="flex max-w-xl gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={40}
              placeholder="Số hiệu chuyến bay hoặc sân bay, VD: VN 220, SGN"
              aria-label="Tìm chuyến bay"
              className="h-11 min-w-0 flex-1 rounded-full bg-surface px-5 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-full bg-gradient-brand px-6 font-semibold text-white"
            >
              Tìm
            </button>
          </form>
          <FlightBoard q={q} />
        </div>
      )}
      {tab === "thoi-tiet" && <WeatherGrid />}
      {tab === "wifi" && <WifiPlans />}
      {tab === "phong-cho" && <LoungeGrid />}
    </div>
  );
}

// Phòng chờ, fast-track là sản phẩm của chuyên mục Kinh doanh, gắn nhãn dịch-vu-san-bay
async function LoungeGrid() {
  const queryClient = getQueryClient();
  const params = { category: "kinh-doanh", tag: "dich-vu-san-bay", sort: "new" } as const;
  await queryClient.prefetchInfiniteQuery(productListOptions(params));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductGrid category={params.category} tag={params.tag} sort={params.sort} />
    </HydrationBoundary>
  );
}
```

`/tien-ich` chuyển hướng sang tab đầu (`page.tsx` gọi `redirect`). `notFound()` cho tab không có. Tab "Phòng chờ & fast-track" là danh sách sản phẩm
của chuyên mục Kinh doanh gắn nhãn `dich-vu-san-bay` (dùng lại `ProductGrid`, prefetch trên server).

Nối vào trang chủ (`app/page.tsx`: `<UtilityPanel flights={home.flights} />`) và trang Bạn (`app/ban/page.tsx`: mục "Chuyến bay sắp tới" dùng `<UpcomingFlights />`).
Đổi `components/icons/Icon.tsx` thêm icon `plane`, `wifi`, `sun`, `cloud`, `rain`, `storm`, `fog`, `snow`, `luggage`, `gate` (lấy từ mockup).

## Kiểm tra

```bash
make fe-format && make fe-lint && make fe-typecheck && make lint && make vuln
```

Trên trình duyệt (đã thử bằng Chrome headless, 1440 px và 390 px):

1. `/` có khối Tiện ích: ô tra cứu, 2 chuyến đang bay, 4 lối tắt.
2. `/tien-ich/flightradar`: bản đồ có đường bay và 2 máy bay, bảng 19 chuyến; `?q=tokyo` còn 2 chuyến; `?q=zzz` hiện "Không có chuyến bay nào khớp".
3. `/tien-ich/thoi-tiet`: 8 thẻ thời tiết, dòng "Cập nhật 8 phút trước · nguồn Open-Meteo".
4. `/tien-ich/wifi`: bấm "Chọn gói" hiện hướng dẫn.
5. `/tien-ich/phong-cho`: 2 sản phẩm dịch vụ sân bay.
6. `/tien-ich/ra-tau-bay` (đã đăng nhập): thêm VN 220 ngày mai ghế 3a hạng Thương gia → thẻ lên máy bay (SGN 08:00 → HAN 10:10, cửa 12, lên tàu 07:20); thêm trùng báo lỗi; ghế `99Z` báo lỗi ở ô ghế.
7. `/ban`: "Chuyến bay sắp tới" hiện thẻ; bấm "Bỏ chuyến này" thì mất.
8. Điện thoại 390 px: không cuộn ngang. Console không có lỗi hay cảnh báo.

## Hay gặp lỗi

- **`wifiPlansOptions is not a function` dù file có hàm đó**: dev server của Next giữ cache module cũ sau khi cài thêm thư viện. `docker compose restart frontend`.
- **Hàng chuyến bay tràn ra ngoài khung (cuộn ngang)**: cột lưới đặt theo **chiều rộng màn hình** (`sm:grid-cols-[...8rem...]`) nhưng khung chứa nó chỉ rộng 1/3 trang. Bố cục
  của thành phần dùng ở nhiều chỗ phải chịu được khung hẹp: ở đây dồn giờ và tên thành phố xuống dòng hai, có `truncate`.
- **Bản đồ xám, không có ô bản đồ**: máy không ra được `tile.openstreetmap.org` (tường lửa, mạng nội bộ). Đường bay và máy bay vẫn vẽ vì chúng là lớp của ta; tự kiểm tra bằng `curl -I https://tile.openstreetmap.org/0/0/0.png`.
- **ESLint `no-img-element` cho logo SVG**: cùng cách với Footer, thêm `eslint-disable-next-line` kèm lý do ("SVG tĩnh").
- **`pkill -f` tên Chrome làm sập luôn shell**: câu lệnh chứa chính tên tiến trình bạn tìm nên `pkill -f` giết cả nó. Dùng `pgrep -f '<mẫu>' | xargs kill` trên mẫu không xuất hiện trong lệnh của bạn, hoặc lưu PID.
