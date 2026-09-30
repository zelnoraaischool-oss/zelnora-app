// 変数（差し込み項目）の定義・検証・表示。サーバーとブラウザの両方で使う。

export const VARIABLE_TYPES = {
  text: "テキスト",
  longtext: "長文",
  date: "日付",
  number: "数値",
  money: "金額（円）",
  email: "メールアドレス",
  phone: "電話番号",
  address: "住所",
  select: "選択肢",
  checkbox: "チェックボックス",
} as const;
export type VariableType = keyof typeof VARIABLE_TYPES;

export interface VariableRules {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minDate?: string; // YYYY-MM-DD
  maxDate?: string;
}

export interface VariableDef {
  /** 表示名。本文では {{表示名}} として差し込む */
  key: string;
  type: VariableType;
  filledBy: "admin" | "signer";
  required: boolean;
  defaultValue?: string;
  options?: string[];
  rules?: VariableRules;
  /** プレビュー用のサンプル値 */
  sample?: string;
  help?: string;
}

/** システムが自動で埋める変数 */
export const SYSTEM_VARIABLES = ["発注者名", "契約ID", "契約締結日"] as const;
export type SystemVariable = (typeof SYSTEM_VARIABLES)[number];

export const VARIABLE_KEY_PATTERN = /^[^{}\s][^{}]{0,39}$/;
export const VARIABLE_PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function isValidVariableKey(key: string): boolean {
  return VARIABLE_KEY_PATTERN.test(key) && !key.endsWith(" ");
}

function toHalfWidth(s: string): string {
  return s.normalize("NFKC");
}

/** 入力値を保存形式に正規化する（金額・数値は半角数字、日付は YYYY-MM-DD、チェックは "true"/"false"） */
export function normalizeValue(def: VariableDef, raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  switch (def.type) {
    case "money":
    case "number": {
      const s = toHalfWidth(v).replace(/[,，円\s]/g, "");
      return s;
    }
    case "phone":
      return toHalfWidth(v).replace(/[^\d+-]/g, "");
    case "email":
      return toHalfWidth(v).toLowerCase();
    case "date":
      return toHalfWidth(v).replace(/\//g, "-");
    case "checkbox":
      return v === "true" || v === "on" || v === "1" ? "true" : "false";
    default:
      return v;
  }
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 正規化済みの値を検証し、エラーメッセージ（日本語）を返す。問題なければ null */
export function validateValue(def: VariableDef, value: string): string | null {
  const r = def.rules ?? {};
  if (def.type === "checkbox") {
    if (def.required && value !== "true") return `「${def.key}」にチェックしてください`;
    return null;
  }
  if (value === "") return def.required ? `「${def.key}」を入力してください` : null;
  if (r.minLength !== undefined && [...value].length < r.minLength)
    return `「${def.key}」は${r.minLength}文字以上で入力してください`;
  if (r.maxLength !== undefined && [...value].length > r.maxLength)
    return `「${def.key}」は${r.maxLength}文字以内で入力してください`;
  switch (def.type) {
    case "money":
    case "number": {
      const re = def.type === "money" ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
      if (!re.test(value)) return `「${def.key}」は数値で入力してください`;
      const n = Number(value);
      if (r.min !== undefined && n < r.min) return `「${def.key}」は${r.min.toLocaleString("ja-JP")}以上にしてください`;
      if (r.max !== undefined && n > r.max) return `「${def.key}」は${r.max.toLocaleString("ja-JP")}以下にしてください`;
      return null;
    }
    case "date": {
      if (!isValidDate(value)) return `「${def.key}」は正しい日付で入力してください`;
      if (r.minDate && value < r.minDate) return `「${def.key}」は${formatDate(r.minDate)}以降の日付にしてください`;
      if (r.maxDate && value > r.maxDate) return `「${def.key}」は${formatDate(r.maxDate)}以前の日付にしてください`;
      return null;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : `「${def.key}」のメールアドレスの形式が正しくありません`;
    case "phone":
      return /^\+?[\d-]{10,15}$/.test(value) ? null : `「${def.key}」の電話番号の形式が正しくありません`;
    case "select":
      return def.options?.includes(value) ? null : `「${def.key}」は選択肢から選んでください`;
    default:
      return null;
  }
}

export function validateValues(
  defs: VariableDef[],
  values: Record<string, string>,
  filledBy?: "admin" | "signer",
): { values: Record<string, string>; errors: Record<string, string> } {
  const out: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    if (filledBy && def.filledBy !== filledBy) continue;
    const raw = values[def.key] ?? (filledBy ? def.defaultValue : undefined) ?? "";
    const v = normalizeValue(def, raw);
    const err = validateValue(def, v);
    if (err) errors[def.key] = err;
    out[def.key] = v;
  }
  return { values: out, errors };
}

export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 本文・PDFに表示する形式に整える */
export function formatValue(def: VariableDef | undefined, value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (!def) return value;
  switch (def.type) {
    case "money": {
      const n = Number(value);
      return Number.isFinite(n) ? `${n.toLocaleString("ja-JP")}円` : value;
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("ja-JP") : value;
    }
    case "date":
      return formatDate(value);
    case "checkbox":
      return value === "true" ? "はい" : "いいえ";
    default:
      return value;
  }
}

export function sampleValue(def: VariableDef): string {
  if (def.sample) return def.sample;
  if (def.defaultValue) return def.defaultValue;
  switch (def.type) {
    case "money":
      return "30000";
    case "number":
      return "1";
    case "date":
      return "2026-10-01";
    case "email":
      return "sample@example.com";
    case "phone":
      return "090-1234-5678";
    case "address":
      return "東京都千代田区丸の内1-1-1";
    case "select":
      return def.options?.[0] ?? "選択肢";
    case "checkbox":
      return "true";
    default:
      return `（${def.key}）`;
  }
}

/** JSONで受け取った変数定義を検証して型付きにする */
export function parseVariableDefs(input: unknown): VariableDef[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: VariableDef[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const type = typeof o.type === "string" && o.type in VARIABLE_TYPES ? (o.type as VariableType) : "text";
    if (!isValidVariableKey(key) || seen.has(key)) continue;
    seen.add(key);
    const rules: VariableRules = {};
    const ro = (o.rules ?? {}) as Record<string, unknown>;
    for (const k of ["minLength", "maxLength", "min", "max"] as const) {
      if (ro[k] !== undefined && ro[k] !== null && ro[k] !== "" && Number.isFinite(Number(ro[k]))) rules[k] = Number(ro[k]);
    }
    for (const k of ["minDate", "maxDate"] as const) {
      if (typeof ro[k] === "string" && isValidDate(ro[k] as string)) rules[k] = ro[k] as string;
    }
    out.push({
      key,
      type,
      filledBy: o.filledBy === "signer" ? "signer" : "admin",
      required: o.required !== false,
      defaultValue: typeof o.defaultValue === "string" && o.defaultValue !== "" ? o.defaultValue : undefined,
      options:
        type === "select" && Array.isArray(o.options)
          ? o.options.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
          : undefined,
      rules: Object.keys(rules).length ? rules : undefined,
      sample: typeof o.sample === "string" && o.sample !== "" ? o.sample : undefined,
      help: typeof o.help === "string" && o.help !== "" ? o.help : undefined,
    });
  }
  return out;
}
