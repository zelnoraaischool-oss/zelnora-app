import { addMonths, isDate, monthOf } from "./dates";
import type { Closing, Plan, RevenueRule } from "./types";
import { roundYen } from "./util";

export interface Amounts {
  excl: number;
  tax: number;
  incl: number;
}

/** 税込・税抜のどちらかから、税額と他方を計算する（ZN-REV-09） */
export function computeTax(amount: number, basis: "excl" | "incl", rate: number, rounding: "floor" | "round"): Amounts {
  if (basis === "excl") {
    const tax = roundYen(amount * rate, rounding);
    return { excl: amount, tax, incl: amount + tax };
  }
  const tax = roundYen((amount * rate) / (1 + rate), rounding);
  return { excl: amount - tax, tax, incl: amount };
}

/** 改定日以降の契約だけが新しい価格になる（ZN-REV-08） */
export function priceAt(plan: Pick<Plan, "priceExcl" | "priceIncl" | "priceHistory">, date: string): { excl: number; incl: number } {
  const hist = [...(plan.priceHistory ?? [])].filter((h) => h.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const h = hist[0];
  if (h) return { excl: h.priceExcl, incl: h.priceIncl };
  // 最初の改定より前の日付：最も古い改定の「改定前」価格が分からないため、現在価格を使う
  return { excl: plan.priceExcl, incl: plan.priceIncl };
}

export interface ScheduleLine extends Amounts {
  month: string;
  dueDate: string | null;
  installmentNo: number | null;
}

export interface ScheduleInput {
  rule: RevenueRule;
  /** 税込の総額（月額ルールなら月額） */
  amountIncl: number;
  taxRate: number;
  rounding: "floor" | "round";
  baseDate: string;
  /** 期間按分・月額の月数 */
  months: number;
  installments: { count: number; intervalMonths: number };
}

/** 金額を n 個に分け、端数は最初に寄せる */
function split(total: number, n: number): number[] {
  const each = Math.floor(total / n);
  const rest = total - each * n;
  return Array.from({ length: n }, (_, i) => each + (i === 0 ? rest : 0));
}

/** 計上ルールに従って売上予定を作る（9.1） */
export function revenueSchedule(input: ScheduleInput): ScheduleLine[] {
  if (!isDate(input.baseDate)) throw new Error("baseDate must be YYYY-MM-DD");
  const lines: { month: string; incl: number; dueDate: string | null; installmentNo: number | null }[] = [];
  const base = input.baseDate;
  if (input.rule === "lump") {
    lines.push({ month: monthOf(base), incl: input.amountIncl, dueDate: base, installmentNo: null });
  } else if (input.rule === "prorate") {
    const n = Math.max(1, input.months);
    split(input.amountIncl, n).forEach((incl, i) => lines.push({ month: monthOf(addMonths(base, i)), incl, dueDate: i === 0 ? base : null, installmentNo: null }));
  } else if (input.rule === "installment") {
    const n = Math.max(1, input.installments.count);
    split(input.amountIncl, n).forEach((incl, i) => {
      const due = addMonths(base, i * Math.max(1, input.installments.intervalMonths));
      lines.push({ month: monthOf(due), incl, dueDate: due, installmentNo: i + 1 });
    });
  } else {
    const n = Math.max(1, input.months);
    for (let i = 0; i < n; i++) {
      const due = addMonths(base, i);
      lines.push({ month: monthOf(due), incl: input.amountIncl, dueDate: due, installmentNo: i + 1 });
    }
  }
  // 税額は行ごとに計算し、合計の税額と一致するよう最後の行で調整する（月額は行ごとに独立）
  const out = lines.map((l) => ({ ...l, ...computeTax(l.incl, "incl", input.taxRate, input.rounding) }));
  if (input.rule !== "monthly" && out.length > 1) {
    const total = computeTax(input.amountIncl, "incl", input.taxRate, input.rounding);
    const diff = total.tax - out.reduce((s, l) => s + l.tax, 0);
    const last = out[out.length - 1]!;
    last.tax += diff;
    last.excl -= diff;
  }
  return out.map((l) => ({ month: l.month, dueDate: l.dueDate, installmentNo: l.installmentNo, excl: l.excl, tax: l.tax, incl: l.incl }));
}

export function isClosed(closings: Closing[], month: string): boolean {
  return closings.some((c) => c.month === month && c.status === "closed");
}

/** 締めた月の変更は、翌月以降の最初の未締めの月へ回す（9章） */
export function firstOpenMonth(closings: Closing[], from: string): string {
  let m = from;
  for (let i = 0; i < 240 && isClosed(closings, m); i++) m = monthOf(addMonths(`${m}-01`, 1));
  return m;
}
