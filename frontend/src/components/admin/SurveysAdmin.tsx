"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api";
import { type AdminSurvey, useAdminAction, useAdminGet } from "@/lib/admin";

import { Badge, ErrorNote, ListBox, RowButton } from "./kit";

const LABEL: Record<string, string> = { open: "Đang mở", closed: "Đã đóng", hidden: "Ẩn" };

export function SurveysAdmin() {
  const list = useAdminGet<AdminSurvey[]>("surveys");
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <ListBox isPending={list.isPending} isError={list.isError} empty={list.data?.length === 0}>
        {list.data?.map((s) => (
          <SurveyRow key={s.id} s={s} />
        ))}
      </ListBox>
      <CreateSurvey />
    </div>
  );
}

function SurveyRow({ s }: { s: AdminSurvey }) {
  const update = useAdminAction(`surveys/${s.id}`);
  const remove = useAdminAction(`surveys/${s.id}`, "DELETE");
  const set = (status: string) => update.mutate({ question: s.question, status });
  return (
    <li className="space-y-2 p-4">
      <p className="font-semibold">{s.question}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <Badge value={s.status} label={LABEL[s.status]} />
        {s.options} phương án · {s.votes.toLocaleString("vi-VN")} phiếu
      </p>
      <div className="flex flex-wrap gap-2">
        {s.status !== "open" && (
          <RowButton disabled={update.isPending} onClick={() => set("open")}>
            Mở
          </RowButton>
        )}
        {s.status === "open" && (
          <RowButton disabled={update.isPending} onClick={() => set("closed")}>
            Đóng
          </RowButton>
        )}
        {s.status !== "hidden" && (
          <RowButton disabled={update.isPending} onClick={() => set("hidden")}>
            Ẩn
          </RowButton>
        )}
        <RowButton
          danger
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Xoá khảo sát và ${s.votes} phiếu bình chọn? Không khôi phục được.`))
              remove.mutate(undefined);
          }}
        >
          Xoá
        </RowButton>
      </div>
      <ErrorNote error={update.error ?? remove.error} />
    </li>
  );
}

function CreateSurvey() {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const create = useAdminAction("surveys", "POST");
  const fields = create.error instanceof ApiError ? create.error.fields : undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { question, options },
          {
            onSuccess: () => {
              setQuestion("");
              setOptions(["", ""]);
            },
          },
        );
      }}
      className="h-fit space-y-3 rounded-card bg-surface p-5 shadow-sm ring-1 ring-ink/[0.07]"
    >
      <h2 className="text-lg font-bold">Tạo khảo sát</h2>
      <div className="grid gap-1.5">
        <label htmlFor="sv-q" className="text-sm font-semibold">
          Câu hỏi
        </label>
        <input
          id="sv-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          className="h-11 rounded-card-sm px-4 ring-1 ring-ink/[0.14]"
        />
        {fields?.question && <p className="text-sm text-danger">{fields.question}</p>}
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Phương án (2–6)</legend>
        {options.map((o, i) => (
          <input
            key={i}
            aria-label={`Phương án ${i + 1}`}
            value={o}
            maxLength={100}
            onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-10 rounded-card-sm px-4 ring-1 ring-ink/[0.14]"
          />
        ))}
        {fields?.options && <p className="text-sm text-danger">{fields.options}</p>}
        {options.length < 6 && (
          <button
            type="button"
            onClick={() => setOptions([...options, ""])}
            className="justify-self-start text-sm font-semibold text-brand-700"
          >
            + Thêm phương án
          </button>
        )}
      </fieldset>
      <p className="text-xs text-ink-muted">
        Phương án không sửa được sau khi tạo, vì đổi chữ làm sai ý người đã chọn.
      </p>
      {create.error && !fields && <ErrorNote error={create.error} />}
      <button
        type="submit"
        disabled={create.isPending}
        className="h-11 rounded-full bg-gradient-brand px-6 font-semibold text-white shadow-brand disabled:opacity-60"
      >
        {create.isPending ? "Đang tạo…" : "Tạo khảo sát"}
      </button>
    </form>
  );
}
