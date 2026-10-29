"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/cn";

// Ảnh lớn + hàng ảnh nhỏ để chọn (mockup: .gallery)
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-card bg-surface-3">
        <Image
          src={images[active] ?? images[0] ?? ""}
          alt={alt}
          fill
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Ảnh ${i + 1}`}
            aria-pressed={i === active}
            className={cn(
              "relative aspect-square overflow-hidden rounded-card-sm bg-surface-3 ring-2 transition",
              i === active ? "ring-brand-600" : "ring-transparent hover:ring-brand-200",
            )}
          >
            {/* eager: ảnh nhỏ đầu tiên trùng địa chỉ với ảnh lớn; để lazy thì Next.js tưởng ảnh
                LCP (ảnh lớn) đang tải lười và cảnh báo. Hàng ảnh nhỏ cũng nằm ở màn hình đầu. */}
            <Image src={src} alt="" fill loading="eager" sizes="120px" className="object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
