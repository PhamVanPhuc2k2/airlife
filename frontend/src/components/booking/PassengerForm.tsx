"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { passportName } from "@/lib/shop";
import type { Booking } from "@/lib/types";

type Values = {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  passengers: { full_name: string; birth_date: string }[];
};

// Người liên hệ và hành khách. Luật thật (tuổi theo ngày khởi hành, họ tên không dấu, số người
// lớn/trẻ em khớp lúc giữ chỗ) do backend kiểm tra (booking.validateDetails) và trả lỗi theo
// từng ô: tên lỗi "passengers.0.full_name" trùng đúng tên ô của react-hook-form.
export function PassengerForm({ booking: b }: { booking: Booking }) {
  const qc = useQueryClient();
  const { me } = useMe();
  // Thứ tự ô: người lớn trước, trẻ em sau (như lúc giữ chỗ)
  const kinds = [
    ...Array.from({ length: b.adults }, () => "Người lớn"),
    ...Array.from({ length: b.children }, () => "Trẻ em (2–11 tuổi)"),
  ];
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: {
      contact_name: b.contact?.name ?? me?.display_name ?? "",
      contact_phone: b.contact?.phone ?? "",
      contact_email: b.contact?.email ?? me?.email ?? "",
      passengers: kinds.map((_, i) => ({
        full_name: b.passengers[i]?.full_name ?? "",
        birth_date: b.passengers[i]?.birth_date ?? "",
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: "passengers" });
  const names = useWatch({ control, name: "passengers" });

  const save = useMutation({
    mutationFn: (v: Values) =>
      api<Booking>(`/me/bookings/${b.code}/details`, { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: (booking) => qc.setQueryData(["me", "booking", b.code], booking),
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    },
  });
  const apiError = save.error instanceof ApiError ? save.error : null;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-6">
      <fieldset className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-3">
        <legend className="sr-only">Người liên hệ</legend>
        <h2 className="text-lg font-bold sm:col-span-3">Người liên hệ</h2>
        <Field
          label="Họ tên"
          autoComplete="name"
          error={errors.contact_name?.message}
          {...register("contact_name")}
        />
        <Field
          label="Số điện thoại"
          type="tel"
          autoComplete="tel"
          error={errors.contact_phone?.message}
          {...register("contact_phone")}
        />
        <Field
          label="Email nhận vé"
          type="email"
          autoComplete="email"
          error={errors.contact_email?.message}
          {...register("contact_email")}
        />
      </fieldset>

      {fields.map((f, i) => {
        const e = errors.passengers?.[i];
        const preview = passportName(names?.[i]?.full_name ?? "");
        return (
          <fieldset
            key={f.id}
            className="grid gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:grid-cols-[2fr_1fr]"
          >
            <legend className="sr-only">Hành khách {i + 1}</legend>
            <h2 className="text-lg font-bold sm:col-span-2">
              Hành khách {i + 1} <small className="font-normal text-ink-muted">· {kinds[i]}</small>
            </h2>
            <div>
              <Field
                label="Họ và tên (như trên CCCD, hộ chiếu)"
                autoComplete="off"
                error={e?.full_name?.message}
                {...register(`passengers.${i}.full_name`)}
              />
              {preview && <p className="mt-1 text-xs text-ink-muted">In trên vé: {preview}</p>}
            </div>
            <Field
              label="Ngày sinh"
              type="date"
              error={e?.birth_date?.message}
              {...register(`passengers.${i}.birth_date`)}
            />
          </fieldset>
        );
      })}

      {apiError && (
        <p role="alert" className="rounded-card-sm bg-danger/10 p-3 text-sm text-danger">
          {apiError.fields?.passengers ?? apiError.message}
        </p>
      )}
      <button
        type="submit"
        disabled={save.isPending}
        className="h-12 w-full rounded-full bg-gradient-brand font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60 sm:w-auto sm:px-10"
      >
        {save.isPending
          ? "Đang lưu…"
          : b.status === "awaiting_payment"
            ? "Cập nhật thông tin"
            : "Tiếp tục"}
      </button>
    </form>
  );
}
