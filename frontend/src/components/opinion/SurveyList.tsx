"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/icons/Icon";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { surveysOptions } from "@/lib/queries";
import type { Survey } from "@/lib/types";

// Tab "Khảo sát": mọi khảo sát đang mở / đã đóng kèm kết quả.
export function SurveyList() {
  const { data, isPending, isError } = useQuery(surveysOptions());
  if (isPending) return <div className="h-48 animate-pulse rounded-card bg-surface-2" />;
  if (isError) return <p className="text-ink-muted">Không tải được khảo sát, vui lòng thử lại.</p>;
  if (!data.length) return <p className="text-ink-muted">Chưa có khảo sát nào.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((s) => (
        <SurveyCard key={s.id} survey={s} />
      ))}
    </div>
  );
}

// Khối "Ý kiến" ở trang chủ: khảo sát đang mở đầu tiên. Chưa tải xong hoặc không có thì không hiện.
export function HomeSurvey() {
  const { data } = useQuery(surveysOptions());
  const first = data?.find((s) => s.open);
  if (!first) return null;
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Ý kiến</h2>
        <Link
          href="/y-kien/khao-sat"
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Tham gia
        </Link>
      </div>
      <div className="max-w-xl">
        <SurveyCard survey={first} />
      </div>
    </section>
  );
}

export function SurveyCard({ survey: s }: { survey: Survey }) {
  const { me } = useMe();
  const pathname = usePathname();
  const qc = useQueryClient();

  const vote = useMutation({
    mutationFn: (optionId: string) =>
      api<void>(`/surveys/${s.id}/vote`, {
        method: "POST",
        body: JSON.stringify({ option_id: optionId }),
      }),
    // Thành công hay "đã bình chọn rồi" đều tải lại để thấy kết quả thật
    onSettled: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });

  const voted = s.my_option !== null;
  const canVote = s.open && !voted && !!me?.email_verified;
  const error = vote.error instanceof ApiError ? vote.error.message : null;

  return (
    <section className="space-y-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]">
      <h3 className="flex gap-2 font-bold">
        <Icon name="poll" className="mt-0.5 size-5 shrink-0 text-brand-600" />
        {s.question}
      </h3>
      <ul className="grid gap-2">
        {s.options.map((o) => {
          const picked = o.id === s.my_option;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={!canVote || vote.isPending}
                onClick={() => vote.mutate(o.id)}
                aria-pressed={picked}
                className={cn(
                  "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-card-sm px-4 py-2.5 text-left ring-1 ring-ink/[0.12]",
                  canVote && "hover:ring-brand-500",
                  picked && "ring-2 ring-brand-500",
                )}
              >
                {/* Thanh kết quả: chỉ hiện khi đã bình chọn hoặc khảo sát đã đóng */}
                {(voted || !s.open) && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0",
                      picked ? "bg-brand-100" : "bg-surface-2",
                    )}
                    style={{ width: `${o.percent}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  {picked && <Icon name="check" className="size-4 text-brand-700" />}
                  {o.label}
                </span>
                {(voted || !s.open) && <b className="relative">{o.percent}%</b>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-ink-muted">
        {s.total_votes.toLocaleString("vi-VN")} lượt bình chọn
        {!s.open && " · đã đóng"}
        {canVote && " · chọn một phương án để xem kết quả"}
      </p>
      {!me && s.open && (
        <p className="text-sm">
          <Link
            href={`/dang-nhap?next=${encodeURIComponent(pathname)}`}
            className="font-semibold text-brand-700"
          >
            Đăng nhập
          </Link>{" "}
          để bình chọn.
        </p>
      )}
      {me && !me.email_verified && s.open && !voted && (
        <p className="text-sm">
          Xác minh email để bình chọn.{" "}
          <Link href="/ban" className="font-semibold text-brand-700">
            Gửi lại email xác minh
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
