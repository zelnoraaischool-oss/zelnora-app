import { audit, type Ctx } from "./context";
import { addMonthToMonth, dateOfIso, durationMonths, monthOf, nowIso, today } from "./dates";
import { can, productAllowed } from "./permissions";
import { computeTax, firstOpenMonth, isClosed, revenueSchedule } from "./revenue";
import { visibleRevenues } from "./scope";
import { getPlan, getProduct, getSettings } from "./settings";
import type { Closing, Contract, Customer, Deal, Plan, Product, Revenue, User } from "./types";
import { newId, ZnError } from "./util";

export function closings(ctx: Ctx): Closing[] {
  return ctx.store.all<Closing>("closings");
}

/** 契約から売上予定を作る（ZN-REV-02）。締めた月に当たる分は翌月以降に回す */
export function createRevenueForContract(ctx: Ctx, contract: Contract, deal: Deal, opts: { baseDate?: string } = {}): Revenue[] {
  const plan = getPlan(ctx, contract.planId);
  const product = getProduct(ctx, contract.productId);
  const rule = plan.revenueRule ?? product.revenueRule;
  const base = opts.baseDate ?? contract.signedAt;
  const lines = revenueSchedule({
    rule,
    amountIncl: contract.amountIncl,
    taxRate: plan.taxRate,
    rounding: plan.rounding,
    baseDate: base,
    months: durationMonths(plan.duration),
    installments: plan.payment.type === "installment" ? { count: plan.payment.count, intervalMonths: plan.payment.intervalMonths } : { count: 1, intervalMonths: 1 },
  });
  const cl = closings(ctx);
  const now = nowIso(ctx.clock);
  const rows = lines.map((l) => {
    const r: Revenue = {
      id: newId("rv", ctx.clock),
      customerId: contract.customerId,
      productId: contract.productId,
      planId: contract.planId,
      dealId: deal.id,
      contractId: contract.id,
      owner: deal.owner,
      kind: "sale",
      amountExcl: l.excl,
      tax: l.tax,
      amountIncl: l.incl,
      month: firstOpenMonth(cl, l.month),
      status: "planned",
      paymentMethod: contract.paymentMethod,
      dueDate: l.dueDate,
      paidAt: null,
      paidAmount: null,
      installmentNo: l.installmentNo,
      parentId: null,
      note: l.month !== firstOpenMonth(cl, l.month) ? `本来の計上月 ${l.month}（締め済みのため繰り越し）` : "",
      createdAt: now,
      updatedAt: now,
    };
    ctx.store.put("revenues", r);
    return r;
  });
  return rows;
}

function getRevenue(ctx: Ctx, id: string): Revenue {
  const r = ctx.store.get<Revenue>("revenues", id);
  if (!r) throw new ZnError("売上が見つかりません", "not_found");
  return r;
}

function requireEditable(ctx: Ctx, user: User, r: Revenue) {
  if (!can(user, "revenues.edit")) throw new ZnError("売上を編集する権限がありません", "forbidden");
  if (!productAllowed(user, r.productId)) throw new ZnError("担当外の商材です", "forbidden");
  if (isClosed(closings(ctx), r.month)) {
    throw new ZnError(`${r.month} は締め済みのため編集できません。修正は翌月以降の調整として記録してください`, "closed");
  }
}

/** 入金の記録（ZN-REV-03） */
export function recordPayment(ctx: Ctx, user: User, id: string, paidAt: string, amount?: number): Revenue {
  const r = getRevenue(ctx, id);
  if (!can(user, "revenues.edit")) throw new ZnError("売上を編集する権限がありません", "forbidden");
  // 入金日の記録は締め後でも可（金額は変えない）。計上の基準が入金日の商材は、未締めなら入金月に計上する
  const product = getSettings(ctx).products.find((p) => p.id === r.productId);
  const month = product?.revenueBasis === "payment" && !isClosed(closings(ctx), r.month) ? firstOpenMonth(closings(ctx), monthOf(paidAt)) : r.month;
  const next: Revenue = { ...r, month, paidAt, paidAmount: amount ?? r.amountIncl, status: r.status === "planned" ? "confirmed" : r.status, updatedAt: nowIso(ctx.clock) };
  ctx.store.put("revenues", next);
  audit(ctx, user, "revenue.payment", "revenues", id, { paidAt, amount: next.paidAmount });
  return next;
}

export function updateRevenue(ctx: Ctx, user: User, id: string, patch: { amountIncl?: number; month?: string; status?: Revenue["status"]; note?: string; dueDate?: string | null }): Revenue {
  const r = getRevenue(ctx, id);
  requireEditable(ctx, user, r);
  if (patch.month && isClosed(closings(ctx), patch.month)) throw new ZnError(`${patch.month} は締め済みです`, "closed");
  const plan = getSettings(ctx).plans.find((p) => p.id === r.planId);
  const amounts = patch.amountIncl !== undefined ? computeTax(patch.amountIncl, "incl", plan?.taxRate ?? 0.1, plan?.rounding ?? "floor") : null;
  const next: Revenue = {
    ...r,
    ...(amounts ? { amountExcl: amounts.excl, tax: amounts.tax, amountIncl: amounts.incl } : {}),
    ...(patch.month ? { month: patch.month } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    updatedAt: nowIso(ctx.clock),
  };
  ctx.store.put("revenues", next);
  audit(ctx, user, "revenue.update", "revenues", id, { before: r, patch });
  return next;
}

/** 返金・値引き・調整：マイナスの売上として元の売上に紐付ける（ZN-REV-04） */
export function addAdjustment(
  ctx: Ctx,
  user: User,
  parentId: string,
  input: { kind: "refund" | "discount" | "adjustment"; amountIncl: number; month?: string; note?: string },
): Revenue {
  const parent = getRevenue(ctx, parentId);
  if (!can(user, "revenues.edit")) throw new ZnError("売上を編集する権限がありません", "forbidden");
  if (!productAllowed(user, parent.productId)) throw new ZnError("担当外の商材です", "forbidden");
  if (!(input.amountIncl > 0) && input.kind !== "adjustment") throw new ZnError("金額を入力してください");
  const month = firstOpenMonth(closings(ctx), input.month ?? monthOf(today(ctx.clock)));
  const plan = getSettings(ctx).plans.find((p) => p.id === parent.planId);
  const signed = input.kind === "adjustment" ? input.amountIncl : -Math.abs(input.amountIncl);
  const t = computeTax(Math.abs(signed), "incl", plan?.taxRate ?? 0.1, plan?.rounding ?? "floor");
  const sign = signed < 0 ? -1 : 1;
  const now = nowIso(ctx.clock);
  const r: Revenue = {
    ...parent,
    id: newId("rv", ctx.clock),
    kind: input.kind,
    amountExcl: sign * t.excl,
    tax: sign * t.tax,
    amountIncl: sign * t.incl,
    month,
    status: "confirmed",
    dueDate: null,
    paidAt: null,
    paidAmount: null,
    installmentNo: null,
    parentId,
    note: input.note ?? "",
    createdAt: now,
    updatedAt: now,
  };
  ctx.store.put("revenues", r);
  if (input.kind === "refund") ctx.store.put("revenues", { ...parent, status: parent.status === "canceled" ? parent.status : "refunded", updatedAt: now });
  audit(ctx, user, `revenue.${input.kind}`, "revenues", r.id, { parentId, amountIncl: r.amountIncl, month });
  return r;
}

/** 解約で月額の売上を止める：指定月より後の予定を取り消す */
export function stopFutureRevenues(ctx: Ctx, by: string, dealId: string | null, customerId: string, productId: string, afterMonth: string): number {
  let n = 0;
  for (const r of ctx.store.all<Revenue>("revenues")) {
    if (r.customerId === customerId && r.productId === productId && (dealId === null || r.dealId === dealId) && r.status === "planned" && r.kind === "sale" && r.month > afterMonth && !isClosed(closings(ctx), r.month)) {
      ctx.store.put("revenues", { ...r, status: "canceled", note: `${r.note} 解約により取消`.trim(), updatedAt: nowIso(ctx.clock) });
      n++;
    }
  }
  if (n) audit(ctx, { email: by }, "revenue.stop", "revenues", dealId ?? customerId, { afterMonth, canceled: n });
  return n;
}

/** 月次締め（ZN-REV-06） */
export function closeMonth(ctx: Ctx, user: User, month: string): Closing {
  if (!can(user, "months.close")) throw new ZnError("月次締めの権限がありません", "forbidden");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ZnError("月の形式が正しくありません");
  if (month > monthOf(today(ctx.clock))) throw new ZnError("未来の月は締められません");
  const c: Closing = { id: month, month, closedAt: nowIso(ctx.clock), closedBy: user.email, reopenedAt: null, reopenedBy: null, reopenReason: "", status: "closed" };
  ctx.store.put("closings", c);
  audit(ctx, user, "month.close", "closings", month);
  return c;
}

export function reopenMonth(ctx: Ctx, user: User, month: string, reason: string): Closing {
  if (!can(user, "months.reopen")) throw new ZnError("締めの解除はオーナーのみ可能です", "forbidden");
  if (!reason.trim()) throw new ZnError("解除の理由を入力してください");
  const c = ctx.store.get<Closing>("closings", month);
  if (!c || c.status !== "closed") throw new ZnError("この月は締められていません");
  const next: Closing = { ...c, status: "open", reopenedAt: nowIso(ctx.clock), reopenedBy: user.email, reopenReason: reason.trim() };
  ctx.store.put("closings", next);
  audit(ctx, user, "month.reopen", "closings", month, { reason });
  return next;
}

export interface RevenueFilter {
  month?: string;
  from?: string;
  to?: string;
  productId?: string;
  planId?: string;
  owner?: string;
  status?: Revenue["status"] | "";
  unpaidOnly?: boolean;
  customerId?: string;
}

export function listRevenues(ctx: Ctx, user: User, f: RevenueFilter = {}) {
  if (!can(user, "revenues.view")) throw new ZnError("売上を見る権限がありません", "forbidden");
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c]));
  const s = getSettings(ctx);
  const t = today(ctx.clock);
  return visibleRevenues(ctx, user)
    .filter(
      (r) =>
        (!f.month || r.month === f.month) &&
        (!f.from || r.month >= f.from) &&
        (!f.to || r.month <= f.to) &&
        (!f.productId || r.productId === f.productId) &&
        (!f.planId || r.planId === f.planId) &&
        (!f.owner || r.owner === f.owner) &&
        (!f.status || r.status === f.status) &&
        (!f.customerId || r.customerId === f.customerId) &&
        (!f.unpaidOnly || (r.kind === "sale" && r.status !== "canceled" && !r.paidAt)),
    )
    .map((r) => ({
      ...r,
      customerName: customers.get(r.customerId)?.name ?? "",
      planName: s.plans.find((p) => p.id === r.planId)?.name ?? "",
      productName: s.products.find((p) => p.id === r.productId)?.name ?? "",
      overdue: r.kind === "sale" && r.status !== "canceled" && !r.paidAt && !!r.dueDate && r.dueDate < t,
      closed: isClosed(closings(ctx), r.month),
    }))
    .sort((a, b) => (a.month === b.month ? (a.createdAt < b.createdAt ? 1 : -1) : a.month < b.month ? 1 : -1));
}

export type SummaryGroup = "plan" | "product" | "owner";

/** 月次集計（ZN-REV-05）：月×プラン・商材・担当営業、前月比と前年同月比 */
export function revenueSummary(ctx: Ctx, user: User, opts: { from: string; to: string; groupBy: SummaryGroup; productId?: string; includePlanned?: boolean }) {
  if (!can(user, "revenues.summary")) throw new ZnError("売上を見る権限がありません", "forbidden");
  const s = getSettings(ctx);
  // 閲覧者・営業担当は集計のみ（営業は自分の成約分）
  const rows = (user.role === "viewer" ? ctx.store.all<Revenue>("revenues").filter((r) => productAllowed(user, r.productId)) : visibleRevenues(ctx, user)).filter(
    (r) => r.status !== "canceled" && (opts.includePlanned !== false || r.status !== "planned") && (!opts.productId || r.productId === opts.productId),
  );
  const months: string[] = [];
  for (let m = opts.from; m <= opts.to && months.length < 60; m = addMonthToMonth(m, 1)) months.push(m);
  const keyOf = (r: Revenue) => (opts.groupBy === "plan" ? r.planId : opts.groupBy === "product" ? r.productId : r.owner ?? "（未設定）");
  const labelOf = (k: string) =>
    opts.groupBy === "plan"
      ? `${s.plans.find((p) => p.id === k)?.name ?? k}`
      : opts.groupBy === "product"
        ? s.products.find((p) => p.id === k)?.name ?? k
        : k;
  const amount = (m: string, k?: string) => rows.filter((r) => r.month === m && (!k || keyOf(r) === k)).reduce((a, r) => a + r.amountIncl, 0);
  const keys = [...new Set(rows.filter((r) => r.month >= addMonthToMonth(opts.from, -12) && r.month <= opts.to).map(keyOf))];
  const ratio = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);
  const last = opts.to;
  const groups = keys.map((k) => ({
    key: k,
    label: labelOf(k),
    months: Object.fromEntries(months.map((m) => [m, amount(m, k)])),
    total: months.reduce((a, m) => a + amount(m, k), 0),
    mom: ratio(amount(last, k), amount(addMonthToMonth(last, -1), k)),
    yoy: ratio(amount(last, k), amount(addMonthToMonth(last, -12), k)),
  }));
  const totals = Object.fromEntries(months.map((m) => [m, amount(m)]));
  return {
    months,
    groups: groups.filter((g) => g.total !== 0 || Object.values(g.months).some((v) => v !== 0)).sort((a, b) => b.total - a.total),
    totals,
    total: months.reduce((a, m) => a + amount(m), 0),
    mom: ratio(amount(last), amount(addMonthToMonth(last, -1))),
    yoy: ratio(amount(last), amount(addMonthToMonth(last, -12))),
    closedMonths: months.filter((m) => isClosed(closings(ctx), m)),
  };
}

/** 管理シートに書き出す「月次売上」タブの内容（ZN-REV-07）：月×商材×プランの一覧 */
export function monthlySheet(ctx: Ctx): (string | number)[][] {
  const s = getSettings(ctx);
  const rows = ctx.store.all<Revenue>("revenues").filter((r) => r.status !== "canceled");
  const key = (r: Revenue) => `${r.month}\u0000${r.productId}\u0000${r.planId}`;
  const agg = new Map<string, { month: string; productId: string; planId: string; count: number; excl: number; tax: number; incl: number; confirmed: number }>();
  for (const r of rows) {
    const k = key(r);
    const a = agg.get(k) ?? { month: r.month, productId: r.productId, planId: r.planId, count: 0, excl: 0, tax: 0, incl: 0, confirmed: 0 };
    if (r.kind === "sale") a.count++;
    a.excl += r.amountExcl;
    a.tax += r.tax;
    a.incl += r.amountIncl;
    if (r.status !== "planned") a.confirmed += r.amountIncl;
    agg.set(k, a);
  }
  const cl = closings(ctx);
  const out: (string | number)[][] = [["計上月", "商材", "プラン", "件数", "税抜", "消費税", "税込", "うち確定（税込）", "締め"]];
  for (const a of [...agg.values()].sort((x, y) => (x.month === y.month ? (x.planId < y.planId ? -1 : 1) : x.month < y.month ? 1 : -1))) {
    out.push([
      a.month,
      s.products.find((p) => p.id === a.productId)?.name ?? a.productId,
      s.plans.find((p) => p.id === a.planId)?.name ?? a.planId,
      a.count,
      a.excl,
      a.tax,
      a.incl,
      a.confirmed,
      isClosed(cl, a.month) ? "締め済み" : "",
    ]);
  }
  return out;
}

/** 会計ソフトへ取り込みやすいCSV（ZN-REV-10） */
export function revenueCsv(ctx: Ctx, user: User, month: string, productId?: string): string {
  if (!can(user, "csv.export")) throw new ZnError("CSVを出力する権限がありません", "forbidden");
  const rows = listRevenues(ctx, user, { month, productId }).filter((r) => r.status !== "canceled");
  const head = ["計上月", "取引日", "顧客", "商材", "プラン", "区分", "税抜", "消費税", "税込", "支払方法", "入金日", "状態", "担当", "売上ID", "元の売上ID", "備考"];
  const kind = { sale: "売上", refund: "返金", discount: "値引き", adjustment: "調整" } as const;
  const status = { planned: "予定", confirmed: "確定", canceled: "取消", refunded: "返金済" } as const;
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.month,
      r.dueDate ?? dateOfIso(r.createdAt),
      r.customerName,
      r.productName,
      r.planName,
      kind[r.kind],
      r.amountExcl,
      r.tax,
      r.amountIncl,
      r.paymentMethod,
      r.paidAt ?? "",
      status[r.status],
      r.owner ?? "",
      r.id,
      r.parentId ?? "",
      r.note,
    ]
      .map(esc)
      .join(","),
  );
  audit(ctx, user, "csv.export", "revenues", month, { productId: productId ?? null, rows: rows.length });
  return [head.join(","), ...lines].join("\r\n");
}

/** 担当者別の成績（ZN-REV-11） */
export function ownerPerformance(ctx: Ctx, user: User, from: string, to: string) {
  if (!can(user, "revenues.summary")) throw new ZnError("権限がありません", "forbidden");
  const contracts = ctx.store.all<Contract>("contracts").filter((c) => c.status === "signed" && monthOf(c.signedAt) >= from && monthOf(c.signedAt) <= to && productAllowed(user, c.productId));
  const deals = new Map(ctx.store.all<Deal>("deals").map((d) => [d.id, d]));
  const by = new Map<string, { owner: string; count: number; amount: number }>();
  for (const c of contracts) {
    const owner = deals.get(c.dealId)?.owner ?? "（未設定）";
    if (user.role === "sales" && owner !== user.email) continue;
    const a = by.get(owner) ?? { owner, count: 0, amount: 0 };
    a.count++;
    a.amount += c.amountIncl;
    by.set(owner, a);
  }
  return [...by.values()].map((a) => ({ ...a, average: a.count ? Math.round(a.amount / a.count) : 0 })).sort((a, b) => b.amount - a.amount);
}

/** 売上の見込み（ZN-REV-12）：進行中の商談の見込み金額 × 段階の確度 */
export function forecast(ctx: Ctx, user: User, productId?: string) {
  const s = getSettings(ctx);
  const deals = ctx.store.all<Deal>("deals").filter((d) => d.status === "open" && productAllowed(user, d.productId) && (!productId || d.productId === productId) && (user.role !== "sales" || d.owner === user.email));
  let expected = 0;
  let pipeline = 0;
  for (const d of deals) {
    const product: Product | undefined = s.products.find((p) => p.id === d.productId);
    const stage = product?.stages.find((x) => x.id === d.stageId);
    const plan: Plan | undefined = s.plans.find((p) => p.id === d.planId);
    const amount = d.amount ?? plan?.priceIncl ?? 0;
    pipeline += amount;
    expected += Math.round((amount * (stage?.probability ?? 0)) / 100);
  }
  return { deals: deals.length, pipeline, expected, month: addMonthToMonth(monthOf(today(ctx.clock)), 1) };
}
