"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Field } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/cn";
import type { FeedbackTopic } from "@/lib/types";

const TOPICS: [FeedbackTopic, string][] = [
  ["content", "Nội dung giải trí (phim, nhạc, podcast)"],
  ["shop", "Kinh doanh: vé bay, mua sắm, đơn hàng"],
  ["tour", "Tour bay"],
  ["utility", "Tiện ích: Flightradar, Wi-Fi, phòng chờ"],
  ["website", "Website / ứng dụng"],
  ["other", "Khác"],
];
const RATES = ["Rất tệ", "Chưa tốt", "Bình thường", "Tốt", "Tuyệt vời"];

type Values = {
  topic: FeedbackTopic;
  rating: string; // radio trả chuỗi; gửi lên đổi sang số
  body: string;
  flight_code: string;
  email: string;
};

// Khoá công khai của widget (không phải bí mật). Dev dùng khoá thử của Cloudflare.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Tab "Góp ý": khách chưa đăng nhập cũng gửi được, nên có Turnstile chặn bot.
export function FeedbackForm() {
  const { me } = useMe();
  const widget = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { topic: "content", rating: "4", body: "", flight_code: "", email: "" },
  });

  const send = useMutation({
    mutationFn: (v: Values) =>
      api<void>("/feedback", {
        method: "POST",
        headers: { "X-Turnstile-Token": token },
        body: JSON.stringify({
          ...v,
          rating: Number(v.rating),
          email: v.email || me?.email || "",
        }),
      }),
    onSuccess: () => {
      reset();
      setSent(true);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
      }
    },
    // Token chỉ dùng được MỘT lần, dù gửi thành công hay không: lấy token mới cho lần sau
    onSettled: () => {
      widget.current?.reset();
      setToken("");
    },
  });
  const formError =
    send.error instanceof ApiError && !send.error.fields ? send.error.message : null;

  if (sent) {
    return (
      <div
        role="status"
        className="max-w-2xl space-y-3 rounded-card bg-surface p-6 shadow-sm ring-1 ring-ink/[0.07]"
      >
        <h2 className="text-lg font-bold">Cảm ơn góp ý của bạn!</h2>
        <p className="text-ink-muted">
          Airlife đã nhận được và sẽ phản hồi qua email nếu bạn để lại.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="font-semibold text-brand-700 hover:underline"
        >
          Gửi góp ý khác
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((v) => send.mutate(v))}
      noValidate
      className="grid max-w-2xl gap-4 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07] sm:p-6"
    >
      <h2 className="text-lg font-bold">Gửi góp ý cho Airlife</h2>

      <div className="grid gap-1.5">
        <label htmlFor="fb-topic" className="text-sm font-semibold">
          Bạn góp ý về
        </label>
        <select
          id="fb-topic"
          className="h-11 rounded-card-sm bg-surface px-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500"
          {...register("topic")}
        >
          {TOPICS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-semibold">Mức độ hài lòng</legend>
        <div className="grid grid-cols-5 gap-2">
          {RATES.map((label, i) => (
            <label key={label} className="cursor-pointer">
              <input
                type="radio"
                value={String(i + 1)}
                className="peer sr-only"
                {...register("rating")}
              />
              <span className="grid h-full place-items-center rounded-card-sm px-1 py-2 text-center ring-1 ring-ink/[0.14] peer-checked:bg-brand-50 peer-checked:text-brand-700 peer-checked:ring-2 peer-checked:ring-brand-500 peer-focus-visible:outline-2 peer-focus-visible:outline-brand-500">
                <b>{i + 1}</b>
                <small className="text-[11px] leading-tight text-ink-muted">{label}</small>
              </span>
            </label>
          ))}
        </div>
        {errors.rating && <p className="text-sm text-danger">{errors.rating.message}</p>}
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="fb-body" className="text-sm font-semibold">
          Nội dung
        </label>
        <textarea
          id="fb-body"
          rows={5}
          maxLength={3000}
          placeholder="Điều gì khiến bạn hài lòng hoặc chưa hài lòng?"
          aria-invalid={errors.body ? true : undefined}
          className={cn(
            "rounded-card-sm bg-surface px-4 py-3 ring-1 ring-ink/[0.14] focus-visible:ring-2 focus-visible:ring-brand-500",
            errors.body && "ring-danger",
          )}
          {...register("body", {
            required: "Nhập nội dung góp ý",
            minLength: { value: 10, message: "Nội dung từ 10 ký tự trở lên" },
          })}
        />
        {errors.body && <p className="text-sm text-danger">{errors.body.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Số hiệu chuyến bay (nếu có)"
          placeholder="VD: VN 220"
          autoCapitalize="characters"
          error={errors.flight_code?.message}
          {...register("flight_code")}
        />
        <Field
          label="Email nhận phản hồi"
          type="email"
          placeholder={me?.email ?? "ban@email.com"}
          error={errors.email?.message}
          {...register("email")}
        />
      </div>

      <Turnstile
        ref={widget}
        siteKey={SITE_KEY}
        options={{ theme: "light", language: "vi" }}
        onSuccess={setToken}
        onExpire={() => setToken("")}
        onError={() => setToken("")}
      />

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <button
        type="submit"
        disabled={send.isPending || !token}
        className="h-12 rounded-full bg-gradient-brand px-8 font-semibold text-white shadow-brand disabled:opacity-60 sm:justify-self-start"
      >
        {send.isPending ? "Đang gửi…" : "Gửi góp ý"}
      </button>
    </form>
  );
}
