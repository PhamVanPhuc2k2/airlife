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
