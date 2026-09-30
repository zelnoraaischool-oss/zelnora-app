import type { Ctx } from "./context";
import { addDays, addMonthToMonth, dateOfIso, diffDays, monthOf, today } from "./dates";
import { productAllowed } from "./permissions";
import { isClosed } from "./revenue";
import { forecast } from "./revenues";
import { visibleDeals, visibleDeliveries, visibleRevenues } from "./scope";
import { getSettings } from "./settings";
import type { Closing, Contract, Customer, Deal, Delivery, ProgressItem, Revenue, User } from "./types";

export type Period = "this_month" | "last_month" | "quarter" | { from: string; to: string };

export function periodRange(ctx: Ctx, p: Period): { from: string; to: string; prevFrom: string; prevTo: string } {
  const t = today(ctx.clock);
  const m = monthOf(t);
  const first = (month: string) => `${month}-01`;
  const last = (month: string) => addDays(first(addMonthToMonth(month, 1)), -1);
  if (p === "this_month") return { from: first(m), to: last(m), prevFrom: first(addMonthToMonth(m, -1)), prevTo: last(addMonthToMonth(m, -1)) };
  if (p === "last_month") {
    const lm = addMonthToMonth(m, -1);
    return { from: first(lm), to: last(lm), prevFrom: first(addMonthToMonth(lm, -1)), prevTo: last(addMonthToMonth(lm, -1)) };
  }
  if (p === "quarter") {
    const [y, mm] = m.split("-").map(Number);
    const qStart = `${y}-${String(Math.floor((mm! - 1) / 3) * 3 + 1).padStart(2, "0")}`;
    return { from: first(qStart), to: last(addMonthToMonth(qStart, 2)), prevFrom: first(addMonthToMonth(qStart, -3)), prevTo: last(addMonthToMonth(qStart, -1)) };
  }
  const days = diffDays(p.from, p.to) + 1;
  return { from: p.from, to: p.to, prevFrom: addDays(p.from, -days), prevTo: addDays(p.from, -1) };
}

export interface TodoItem {
  kind: "deal" | "delivery";
  refId: string;
  customerId: string;
  customerName: string;
  productId: string;
  title: string;
  due: string;
  overdue: boolean;
  owner: string | null;
}

/** 今日やること（ZN-DASH-02）：期限順。担当者は自分の分、管理職は担当範囲の全員分 */
export function todoList(ctx: Ctx, user: User, opts: { productId?: string; scope?: "me" | "team"; horizonDays?: number } = {}): TodoItem[] {
  const t = today(ctx.clock);
  const until = addDays(t, opts.horizonDays ?? 0);
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c.name]));
  const mine = opts.scope === "me" || user.role === "sales" || user.role === "delivery";
  const items: TodoItem[] = [];
  for (const d of visibleDeals(ctx, user)) {
    if (d.status === "won" && !d.nextAction) continue;
    if (!d.nextAction || (opts.productId && d.productId !== opts.productId) || (mine && d.owner !== user.email) || d.status === "lost" && !d.nextAction) continue;
    if (d.nextAction.due > until) continue;
    items.push({ kind: "deal", refId: d.id, customerId: d.customerId, customerName: customers.get(d.customerId) ?? "", productId: d.productId, title: d.nextAction.title, due: d.nextAction.due, overdue: d.nextAction.due < t, owner: d.owner });
  }
  for (const d of visibleDeliveries(ctx, user)) {
    if (d.status !== "active" || !d.nextAction || (opts.productId && d.productId !== opts.productId) || (mine && d.owner !== user.email)) continue;
    if (d.nextAction.due > until) continue;
    items.push({ kind: "delivery", refId: d.id, customerId: d.customerId, customerName: customers.get(d.customerId) ?? "", productId: d.productId, title: d.nextAction.title, due: d.nextAction.due, overdue: d.nextAction.due < t, owner: d.owner });
  }
  return items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.customerName.localeCompare(b.customerName)));
}

function change(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** ロール別のホーム（6.1） */
export function dashboard(ctx: Ctx, user: User, opts: { period?: Period; productId?: string } = {}) {
  const t = today(ctx.clock);
  const range = periodRange(ctx, opts.period ?? "this_month");
  const s = getSettings(ctx);
  const inProduct = (pid: string) => !opts.productId || pid === opts.productId;
  const deals = visibleDeals(ctx, user).filter((d) => inProduct(d.productId));
  const deliveries = visibleDeliveries(ctx, user).filter((d) => inProduct(d.productId));
  const contracts = ctx.store.all<Contract>("contracts").filter((c) => c.status === "signed" && productAllowed(user, c.productId) && inProduct(c.productId));
  const dealOwner = new Map(ctx.store.all<Deal>("deals").map((d) => [d.id, d.owner]));
  const myContracts = user.role === "sales" ? contracts.filter((c) => dealOwner.get(c.dealId) === user.email) : contracts;
  const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
  const won = myContracts.filter((c) => inRange(c.signedAt, range.from, range.to));
  const wonPrev = myContracts.filter((c) => inRange(c.signedAt, range.prevFrom, range.prevTo));
  const todo = todoList(ctx, user, { productId: opts.productId });
  const products = s.products.filter((p) => productAllowed(user, p.id) && inProduct(p.id));

  const stageCounts = products.map((p) => ({
    productId: p.id,
    productName: p.name,
    stages: [...p.stages].sort((a, b) => a.order - b.order).map((st) => ({ stageId: st.id, name: st.name, count: deals.filter((d) => d.productId === p.id && d.stageId === st.id && d.status !== "lost").length })),
  }));
  const staleDeals = deals
    .filter((d) => d.status === "open")
    .map((d) => {
      const product = s.products.find((p) => p.id === d.productId);
      const stage = product?.stages.find((x) => x.id === d.stageId);
      return { deal: d, stageName: stage?.name ?? "", days: diffDays(dateOfIso(d.stageEnteredAt), t), limit: stage?.staleDays ?? 14 };
    })
    .filter((x) => x.days >= Math.min(14, x.limit || 14))
    .sort((a, b) => b.days - a.days);

  const items = ctx.store.all<ProgressItem>("progress");
  const activeDeliveries = deliveries.filter((d) => d.status === "active" || d.status === "paused");
  const activeIds = new Set(activeDeliveries.map((d) => d.id));
  const weekEnd = addDays(t, 6);
  const myItems = items.filter((i) => activeIds.has(i.deliveryId) && i.status === "planned");
  const thisWeek = myItems.filter((i) => i.dueDate >= t && i.dueDate <= weekEnd);
  const overdueItems = myItems.filter((i) => i.dueDate < t);
  const endingSoon = activeDeliveries.filter((d) => d.endDate >= t && d.endDate <= addDays(t, 14)).sort((a, b) => (a.endDate < b.endDate ? -1 : 1));

  const revenues = visibleRevenues(ctx, user).filter((r) => inProduct(r.productId) && r.status !== "canceled");
  const m = monthOf(t);
  const sumMonth = (month: string, pred: (r: Revenue) => boolean = () => true) => revenues.filter((r) => r.month === month && pred(r)).reduce((a, r) => a + r.amountIncl, 0);
  const unpaid = revenues.filter((r) => r.kind === "sale" && !r.paidAt && r.dueDate && r.dueDate < t);
  const refundsPlanned = revenues.filter((r) => r.kind === "refund" && r.month >= m);
  const closings = ctx.store.all<Closing>("closings");

  // 担当者別の負荷と遅れ（マネージャー・管理者）
  const owners = [...new Set([...deals.map((d) => d.owner), ...activeDeliveries.map((d) => d.owner)].filter((x): x is string => !!x))];
  const load = owners
    .map((o) => ({
      owner: o,
      openDeals: deals.filter((d) => d.owner === o && d.status === "open").length,
      activeDeliveries: activeDeliveries.filter((d) => d.owner === o).length,
      overdueActions: todo.filter((x) => x.owner === o && x.overdue).length,
      overdueItems: overdueItems.filter((i) => activeDeliveries.find((d) => d.id === i.deliveryId)?.owner === o).length,
    }))
    .sort((a, b) => b.overdueActions + b.overdueItems - (a.overdueActions + a.overdueItems));
  const revenueByProduct = products.map((p) => ({ productId: p.id, name: p.name, amount: sumMonth(m, (r) => r.productId === p.id), prev: sumMonth(addMonthToMonth(m, -1), (r) => r.productId === p.id) }));

  return {
    role: user.role,
    period: range,
    todo,
    sales: {
      wonCount: won.length,
      wonAmount: won.reduce((a, c) => a + c.amountIncl, 0),
      wonCountChange: change(won.length, wonPrev.length),
      wonAmountChange: change(won.reduce((a, c) => a + c.amountIncl, 0), wonPrev.reduce((a, c) => a + c.amountIncl, 0)),
      stageCounts,
      staleDeals: staleDeals.slice(0, 20).map((x) => ({ ...x, customerName: ctx.store.get<Customer>("customers", x.deal.customerId)?.name ?? "" })),
      forecast: forecast(ctx, user, opts.productId),
    },
    delivery: {
      activeCount: activeDeliveries.filter((d) => user.role !== "delivery" || d.owner === user.email).length,
      thisWeek: thisWeek.length,
      overdue: overdueItems.length,
      endingSoon: endingSoon.slice(0, 20).map((d) => ({ delivery: d, customerName: ctx.store.get<Customer>("customers", d.customerId)?.name ?? "" })),
    },
    accounting: {
      month: m,
      planned: sumMonth(m, (r) => r.status === "planned"),
      confirmed: sumMonth(m, (r) => r.status !== "planned"),
      total: sumMonth(m),
      prevTotal: sumMonth(addMonthToMonth(m, -1)),
      totalChange: change(sumMonth(m), sumMonth(addMonthToMonth(m, -1))),
      unpaidCount: unpaid.length,
      unpaidAmount: unpaid.reduce((a, r) => a + r.amountIncl, 0),
      refundsPlanned: refundsPlanned.reduce((a, r) => a + r.amountIncl, 0),
      closing: [0, 1, 2].map((i) => {
        const month = addMonthToMonth(m, -i);
        return { month, closed: isClosed(closings, month) };
      }),
    },
    manager: { load, revenueByProduct },
  };
}

export type { Delivery };
