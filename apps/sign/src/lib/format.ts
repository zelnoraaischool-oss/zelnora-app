// 日時の表示（保存はUTC、表示は日本時間）

const JST = "Asia/Tokyo";

export function formatJst(value: string | Date | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const base = `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
  return opts.seconds ? `${base}:${get("second")}` : base;
}

export function formatJstDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: JST, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}年${get("month")}月${get("day")}日`;
}

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function formatYen(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toLocaleString("ja-JP")}円` : String(n);
}
