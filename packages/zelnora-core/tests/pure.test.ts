import { describe, expect, it } from "vitest";
import school from "../templates/school.json";
import { addMonths, endDateFor } from "../src/dates";
import { findDuplicateGroups, matchCustomer } from "../src/dedupe";
import { planProgress } from "../src/progress";
import { computeTax, priceAt, revenueSchedule } from "../src/revenue";
import { mapAnswers } from "../src/registration";
import type { Customer, FormMapping, ProgressTemplate } from "../src/types";
import { maskPhone, normalizeEmail, normalizePhone } from "../src/util";

describe("日付", () => {
  it("月末をまたぐ月の加算と、期間の終了日", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(endDateFor("2026-10-01", { value: 3, unit: "month" })).toBe("2026-12-31");
    expect(endDateFor("2026-10-01", { value: 2, unit: "week" })).toBe("2026-10-14");
  });
});

describe("進捗テンプレート（8.1 の例）", () => {
  it("初回受講設定・初回受講・2週目以降を毎週・修了を並べる", () => {
    const tpl = school.progressTemplates[0] as ProgressTemplate;
    const items = planProgress(tpl, "2026-10-01", "2026-12-31");
    expect(items[0]).toMatchObject({ name: "初回受講設定", dueDate: "2026-10-03" });
    expect(items[1]).toMatchObject({ name: "初回受講", dueDate: "2026-10-03" });
    expect(items[2]).toMatchObject({ name: "2週目", dueDate: "2026-10-10" });
    expect(items[3]).toMatchObject({ name: "3週目", dueDate: "2026-10-17" });
    const last = items[items.length - 1]!;
    expect(last).toMatchObject({ name: "修了", dueDate: "2026-12-31" });
    const weekly = items.filter((i) => i.templateItemId === "weekly");
    expect(weekly.every((i) => i.dueDate < "2026-12-31")).toBe(true);
    expect(weekly.length).toBe(12);
  });
});

describe("売上の計上ルール（9.1）", () => {
  it("税込から税額を計算する（切り捨て・四捨五入）", () => {
    expect(computeTax(30000, "incl", 0.1, "floor")).toEqual({ excl: 27273, tax: 2727, incl: 30000 });
    expect(computeTax(27273, "excl", 0.1, "round")).toEqual({ excl: 27273, tax: 2727, incl: 30000 });
  });

  it("一括：基準日の月に全額", () => {
    const s = revenueSchedule({ rule: "lump", amountIncl: 30000, taxRate: 0.1, rounding: "floor", baseDate: "2026-09-30", months: 3, installments: { count: 1, intervalMonths: 1 } });
    expect(s).toEqual([{ month: "2026-09", dueDate: "2026-09-30", installmentNo: null, excl: 27273, tax: 2727, incl: 30000 }]);
  });

  it("期間按分：月数で割り、端数は初月。合計は元の金額・税額と一致", () => {
    const s = revenueSchedule({ rule: "prorate", amountIncl: 100000, taxRate: 0.1, rounding: "floor", baseDate: "2026-10-15", months: 3, installments: { count: 1, intervalMonths: 1 } });
    expect(s.map((l) => l.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(s.map((l) => l.incl)).toEqual([33334, 33333, 33333]);
    expect(s.reduce((a, l) => a + l.tax, 0)).toBe(computeTax(100000, "incl", 0.1, "floor").tax);
    expect(s.every((l) => l.excl + l.tax === l.incl)).toBe(true);
  });

  it("分割払い：支払予定ごとに計上する", () => {
    const s = revenueSchedule({ rule: "installment", amountIncl: 90000, taxRate: 0.1, rounding: "round", baseDate: "2026-10-31", months: 3, installments: { count: 3, intervalMonths: 1 } });
    expect(s.map((l) => [l.month, l.dueDate, l.installmentNo, l.incl])).toEqual([
      ["2026-10", "2026-10-31", 1, 30000],
      ["2026-11", "2026-11-30", 2, 30000],
      ["2026-12", "2026-12-31", 3, 30000],
    ]);
  });

  it("月額：毎月の請求額を計上する", () => {
    const s = revenueSchedule({ rule: "monthly", amountIncl: 11000, taxRate: 0.1, rounding: "floor", baseDate: "2026-10-01", months: 2, installments: { count: 1, intervalMonths: 1 } });
    expect(s.map((l) => [l.month, l.incl, l.tax])).toEqual([
      ["2026-10", 11000, 1000],
      ["2026-11", 11000, 1000],
    ]);
  });

  it("価格改定は改定日以降の契約だけに適用される", () => {
    const plan = { priceExcl: 30000, priceIncl: 33000, priceHistory: [{ effectiveFrom: "2026-11-01", priceExcl: 40000, priceIncl: 44000 }] };
    expect(priceAt(plan, "2026-10-31").incl).toBe(33000);
    expect(priceAt(plan, "2026-11-01").incl).toBe(44000);
  });
});

describe("重複の検出", () => {
  const base = { kana: "", company: "", source: "", status: "lead" as const, tags: [] as string[], salesOwner: null, note: "", custom: {}, createdAt: "", updatedAt: "", version: 1 };
  const customers: Customer[] = [
    { ...base, id: "a", name: "山田太郎", email: "Taro@Example.com ", phone: "090-1234-5678" },
    { ...base, id: "b", name: "山田 太郎", email: "ｔａｒｏ＠example.com", phone: "" },
    { ...base, id: "c", name: "別人", email: "other@example.com", phone: "+81 90 1234 5678" },
  ];
  it("メール・電話を正規化して候補を出す", () => {
    expect(normalizeEmail(" ＴＡＲＯ＠example.com")).toBe("taro@example.com");
    expect(normalizePhone("+81 90-1234-5678")).toBe("09012345678");
    const g = findDuplicateGroups(customers);
    expect(g.map((x) => [x.reason, x.customerIds.sort()])).toEqual([
      ["email", ["a", "b"]],
      ["phone", ["a", "c"]],
    ]);
    expect(matchCustomer(customers, { email: "TARO@example.com" }, ["email"]).map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
  it("電話番号を伏せる", () => {
    expect(maskPhone("090-1234-5678")).toBe("090-****-5678");
  });
});

describe("フォームの対応付け", () => {
  it("姓と名・セイとメイが別の質問なら、氏名とふりがなにまとめる", () => {
    const form = {
      mapping: { a: "customer.lastName", b: "customer.firstName", c: "customer.lastKana", d: "customer.firstKana", e: "customer.email", f: "customer.custom.birthday" },
    } as unknown as FormMapping;
    const r = mapAnswers(form, { a: "河村", b: "悦郎", c: "カワムラ", d: "エツロウ", e: "x@example.com", f: "1974/03/13" });
    expect(r.customer).toEqual({ name: "河村 悦郎", kana: "カワムラ エツロウ", email: "x@example.com" });
    expect(r.custom).toEqual({ birthday: "1974/03/13" });
  });
});
