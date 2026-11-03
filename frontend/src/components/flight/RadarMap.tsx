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
