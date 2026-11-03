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
