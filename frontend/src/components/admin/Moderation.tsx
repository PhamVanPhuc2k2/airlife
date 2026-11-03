"use client";

import { useState } from "react";

import {
  type AdminComment,
  type AdminExperience,
  type AdminFeedback,
  useAdminAction,
  useAdminList,
} from "@/lib/admin";
import { timeAgo } from "@/lib/format";

import { Badge, ErrorNote, FilterBar, ListBox, Pager, RowButton } from "./kit";

const SIZE = 20;
const VISIBLE_STATUSES: [string, string][] = [
  ["", "Tất cả"],
  ["visible", "Đang hiện"],
  ["hidden", "Đã ẩn"],
  ["deleted", "Người viết đã xoá"],
];

// Ẩn / hiện lại một mục. Mục người viết tự xoá thì không khôi phục (API cũng từ chối).
function ToggleButton({ path, status }: { path: string; status: string }) {
  const act = useAdminAction(path);
  if (status === "deleted") return null;
  const hide = status === "visible";
  return (
    <>
      <RowButton
        danger={hide}
        disabled={act.isPending}
        onClick={() => act.mutate({ status: hide ? "hidden" : "visible" })}
      >
        {hide ? "Ẩn" : "Hiện lại"}
      </RowButton>
      {act.error && <ErrorNote error={act.error} />}
    </>
  );
}

export function CommentsAdmin() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminList<AdminComment>("comments", { status, q, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={status}
        statuses={VISIBLE_STATUSES}
        onStatus={(s) => {
          setStatus(s);
          setPage(1);
        }}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
      />
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((c) => (
          <li key={c.id} className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <strong className="text-ink">{c.author}</strong>
                <span>trên “{c.target}”</span>
                <time dateTime={c.created_at} suppressHydrationWarning>
                  {timeAgo(c.created_at)}
                </time>
                <Badge value={c.status} />
              </p>
              <p className="mt-1 whitespace-pre-line break-words">{c.body}</p>
            </div>
            <ToggleButton path={`comments/${c.id}`} status={c.status} />
          </li>
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

export function ExperiencesAdmin() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminList<AdminExperience>("experiences", { status, q, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={status}
        statuses={VISIBLE_STATUSES}
        onStatus={(s) => {
          setStatus(s);
          setPage(1);
        }}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
      />
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((e) => (
          <li key={e.id} className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <strong className="text-ink">{e.author}</strong>
                <span>{e.route}</span>
                <span>{"★".repeat(e.rating)}</span>
                <time dateTime={e.created_at} suppressHydrationWarning>
                  {timeAgo(e.created_at)}
                </time>
                <Badge value={e.status} />
              </p>
              <p className="mt-1 whitespace-pre-line break-words">{e.body}</p>
            </div>
            <ToggleButton path={`experiences/${e.id}`} status={e.status} />
          </li>
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}

const TOPIC: Record<string, string> = {
  content: "Nội dung",
  shop: "Kinh doanh",
  tour: "Tour bay",
  utility: "Tiện ích",
  website: "Website",
  other: "Khác",
};

function FeedbackRow({ f }: { f: AdminFeedback }) {
  const act = useAdminAction(`feedbacks/${f.id}`);
  const done = f.status === "done";
  return (
    <li className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <strong className="text-ink">{f.author || "Khách"}</strong>
          <span>{TOPIC[f.topic] ?? f.topic}</span>
          <span>{f.rating}/5</span>
          {f.flight_code && <span>chuyến {f.flight_code}</span>}
          {f.email && (
            <a href={`mailto:${f.email}`} className="text-brand-700">
              {f.email}
            </a>
          )}
          <time dateTime={f.created_at} suppressHydrationWarning>
            {timeAgo(f.created_at)}
          </time>
          <Badge value={f.status} label={done ? "Đã xử lý" : "Mới"} />
        </p>
        <p className="mt-1 whitespace-pre-line break-words">{f.body}</p>
        {act.error && <ErrorNote error={act.error} />}
      </div>
      <RowButton
        disabled={act.isPending}
        onClick={() => act.mutate({ status: done ? "new" : "done" })}
      >
        {done ? "Mở lại" : "Đã xử lý"}
      </RowButton>
    </li>
  );
}

export function FeedbacksAdmin() {
  const [status, setStatus] = useState("new");
  const [page, setPage] = useState(1);
  const list = useAdminList<AdminFeedback>("feedbacks", { status, page, size: SIZE });
  return (
    <div className="space-y-4">
      <FilterBar
        status={status}
        statuses={[
          ["new", "Mới"],
          ["done", "Đã xử lý"],
          ["", "Tất cả"],
        ]}
        onStatus={(s) => {
          setStatus(s);
          setPage(1);
        }}
      />
      <ListBox
        isPending={list.isPending}
        isError={list.isError}
        empty={list.data?.items.length === 0}
      >
        {list.data?.items.map((f) => (
          <FeedbackRow key={f.id} f={f} />
        ))}
      </ListBox>
      {list.data && <Pager page={page} size={SIZE} total={list.data.total} onPage={setPage} />}
    </div>
  );
}
