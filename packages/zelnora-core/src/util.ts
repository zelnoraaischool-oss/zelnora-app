import type { Clock } from "./dates";

let counter = 0;

/** 時刻順に並ぶ短いID（衝突しにくいよう乱数を付ける） */
export function newId(prefix: string, clock: Clock): string {
  counter = (counter + 1) % 1296;
  const t = clock.now().getTime().toString(36);
  const r = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${prefix}_${t}${counter.toString(36).padStart(2, "0")}${r}`;
}

/** メールアドレスの正規化（全角→半角、小文字、前後の空白、Gmailのドットは区別する） */
export function normalizeEmail(v: string | null | undefined): string {
  return toHalfWidth(v ?? "")
    .trim()
    .toLowerCase();
}

/** 電話番号の正規化（数字のみ。+81 は 0 に） */
export function normalizePhone(v: string | null | undefined): string {
  let s = toHalfWidth(v ?? "").replace(/[^\d+]/g, "");
  if (s.startsWith("+81")) s = `0${s.slice(3)}`;
  return s.replace(/\D/g, "");
}

export function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

export function normalizeName(v: string | null | undefined): string {
  return toHalfWidth(v ?? "").replace(/\s+/g, "").trim();
}

/** 電話番号を伏せる（例 090-****-1234） */
export function maskPhone(v: string): string {
  const d = normalizePhone(v);
  if (d.length < 4) return v ? "****" : "";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

export function maskEmail(v: string): string {
  const [u, dom] = v.split("@");
  if (!u || !dom) return v ? "****" : "";
  return `${u.slice(0, 1)}***@${dom}`;
}

export function roundYen(v: number, mode: "floor" | "round"): number {
  return mode === "floor" ? Math.floor(v + 1e-9) : Math.round(v);
}

export function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export class ZnError extends Error {
  constructor(
    message: string,
    readonly code: string = "bad_request",
    readonly details?: unknown,
  ) {
    super(message);
  }
}
