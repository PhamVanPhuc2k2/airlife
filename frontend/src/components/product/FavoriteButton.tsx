"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";

const cls =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition hover:bg-surface-3";

// Nút trái tim "Yêu thích" ở trang sản phẩm (tab Yêu thích ở Sưu tập)
export function FavoriteButton({ slug }: { slug: string }) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();
  const key = ["me", "product", slug];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ favorite: boolean }>(`/me/products/${slug}`),
    enabled: !!me,
  });
  const fav = data?.favorite ?? false;
  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api<void>(`/me/favorites/${slug}`, { method: next ? "PUT" : "DELETE" }),
    onMutate: (next) => qc.setQueryData(key, { favorite: next }),
    onError: (_e, next) => qc.setQueryData(key, { favorite: !next }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["me", "favorites"] }),
  });

  if (!me) {
    return (
      <Link
        href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
        className={cls}
        aria-label="Yêu thích"
      >
        <Icon name="heart" className="size-5" />
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => toggle.mutate(!fav)}
      disabled={!data}
      aria-pressed={fav}
      aria-label={fav ? "Bỏ yêu thích" : "Yêu thích"}
      className={cn(cls, fav && "text-danger")}
    >
      <Icon name="heart" className={cn("size-5", fav && "fill-current")} />
    </button>
  );
}
