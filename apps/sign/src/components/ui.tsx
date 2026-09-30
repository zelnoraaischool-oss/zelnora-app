import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
  secondary: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
  ghost: "text-slate-700 hover:bg-slate-100",
};

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...p}
    />
  );
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition",
        VARIANTS[variant],
        className,
      )}
      {...p}
    />
  );
}

export function Card({ className, title, actions, children }: { className?: string; title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={cx("rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-base text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:text-sm";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...p} />;
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputClass, className)} {...p} />;
}

export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(inputClass, "pr-8", className)} {...p} />;
}

export function Field({ label, hint, error, required, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="ml-1 text-xs font-normal text-rose-600">必須</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const t = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    error: "bg-rose-50 text-rose-900 ring-rose-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("whitespace-pre-line rounded-lg px-3 py-2 text-sm ring-1", t)}>{children}</div>;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  sent: "送付済",
  viewed: "閲覧済",
  signed: "署名済",
  expired: "期限切れ",
  canceled: "取消",
};

const STATUS_TONES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-sky-100 text-sky-800",
  viewed: "bg-violet-100 text-violet-800",
  signed: "bg-emerald-100 text-emerald-800",
  expired: "bg-amber-100 text-amber-800",
  canceled: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_TONES[status] ?? "bg-slate-100")}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const t = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-rose-100 text-rose-800",
    blue: "bg-sky-100 text-sky-800",
  }[tone];
  return <span className={cx("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", t)}>{children}</span>;
}
