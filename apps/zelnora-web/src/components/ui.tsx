import { type ComponentProps, type ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const V: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
  secondary: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-300",
};

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1 rounded-lg font-semibold transition disabled:cursor-not-allowed",
        size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-10 px-4 text-sm",
        V[variant],
        className,
      )}
      {...p}
    />
  );
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx("inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold", V[variant], className)} {...p} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-bold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 幅の指定（w-*）があれば既定の w-full を外す */
function withWidth(base: string, className?: string): string {
  return className && /(^|\s)w-/.test(className) ? cx(base.replace("w-full", ""), className) : cx(base, className);
}

export const inputClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 disabled:bg-slate-50";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={withWidth(inputClass, className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={withWidth(inputClass, className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={withWidth(`${inputClass} pr-8`, className)} {...p} />;
}

export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="ml-1 font-normal text-rose-600">必須</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const t = { info: "bg-sky-50 text-sky-900 ring-sky-200", error: "bg-rose-50 text-rose-900 ring-rose-200", success: "bg-emerald-50 text-emerald-900 ring-emerald-200", warning: "bg-amber-50 text-amber-900 ring-amber-200" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("whitespace-pre-line rounded-lg px-3 py-2 text-sm ring-1", t)}>{children}</div>;
}

export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "teal" | "violet"; className?: string }) {
  const t = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-rose-100 text-rose-800",
    blue: "bg-sky-100 text-sky-800",
    teal: "bg-teal-100 text-teal-800",
    violet: "bg-violet-100 text-violet-800",
  }[tone];
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", t, className)}>{children}</span>;
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cx("max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button type="button" aria-label="閉じる" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", value === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-slate-400">読み込み中…</p>;
}

export function yen(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : `${n.toLocaleString("ja-JP")}円`;
}

export function pct(n: number | null | undefined): ReactNode {
  if (n === null || n === undefined) return <span className="text-slate-400">—</span>;
  return <span className={n >= 0 ? "text-emerald-700" : "text-rose-700"}>{n >= 0 ? "+" : ""}{n}%</span>;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** CSVをダウンロードする（Excelで文字化けしないようBOM付き） */
export function downloadText(filename: string, text: string, type = "text/csv"): void {
  const blob = new Blob([type === "text/csv" ? "﻿" : "", text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
