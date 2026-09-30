// 日付ユーティリティ。業務日付はすべて日本時間（JST, UTC+9）で扱う。

const JST_OFFSET_MS = 9 * 3600_000;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 日本時間の日付 YYYY-MM-DD */
export function jstDate(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`;
}

export function today(clock: Clock): string {
  return jstDate(clock.now());
}

export function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

export function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 月を足す。月末を超える日は月末に丸める（1/31 + 1か月 = 2/28） */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parse(date);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonthToMonth(month: string, n: number): string {
  return monthOf(addMonths(`${month}-01`, n));
}

export function diffDays(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400_000);
}

/** ISO日時 → 日本時間の日付 */
export function dateOfIso(iso: string): string {
  return isDate(iso) ? iso : jstDate(new Date(iso));
}

export function monthsBetween(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

/** 期間の終了日（開始日を含めて期間分。3か月なら 10/1 → 12/31） */
export function endDateFor(start: string, duration: { value: number; unit: "day" | "week" | "month" }): string {
  if (duration.unit === "day") return addDays(start, duration.value - 1);
  if (duration.unit === "week") return addDays(start, duration.value * 7 - 1);
  return addDays(addMonths(start, duration.value), -1);
}

export function durationMonths(duration: { value: number; unit: "day" | "week" | "month" }): number {
  if (duration.unit === "month") return duration.value;
  const days = duration.unit === "week" ? duration.value * 7 : duration.value;
  return Math.max(1, Math.round(days / 30));
}

export function formatJpDate(date: string | null | undefined): string {
  if (!date) return "";
  const { y, m, d } = parse(date);
  return `${y}/${m}/${d}`;
}
