import { audit, type Ctx } from "./context";
import { recordActivity } from "./customers";
import { addDays, diffDays, endDateFor, monthOf, nowIso, today } from "./dates";
import { label } from "./dictionary";
import { can, productAllowed } from "./permissions";
import { planProgress } from "./progress";
import { createRevenueForContract, stopFutureRevenues } from "./revenues";
import { visibleDeliveries } from "./scope";
import { getPlan, getProduct, getSettings } from "./settings";
import type { Activity, Contract, Customer, Deal, Delivery, DeliveryStatus, ProgressItem, Revenue, User } from "./types";
import { newId, ZnError } from "./util";

/** 提供担当の自動割り当て（ZN-DLV-07）：担当数が少ない人／既定の担当 */
export function pickDeliveryOwner(ctx: Ctx, productId: string): string | null {
  const product = getProduct(ctx, productId);
  if (product.deliveryAssignment === "default") return product.defaultDeliveryOwner ?? null;
  if (product.deliveryAssignment === "manual") return null;
  const users = ctx.store.all<User>("users").filter((u) => u.active && u.role === "delivery" && u.productIds.includes(productId));
  if (!users.length) return product.defaultDeliveryOwner ?? null;
  const active = ctx.store.all<Delivery>("deliveries").filter((d) => d.status === "active" || d.status === "paused");
  const load = (email: string) => active.filter((d) => d.owner === email).length;
  const candidates = users.filter((u) => !u.capacity || load(u.email) < u.capacity).sort((a, b) => load(a.email) - load(b.email) || a.email.localeCompare(b.email));
  return candidates[0]?.email ?? product.defaultDeliveryOwner ?? null;
}

function nextActionOf(items: ProgressItem[]): Delivery["nextAction"] {
  const next = items.filter((i) => i.status === "planned").sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.seq - b.seq))[0];
  return next ? { title: next.name, due: next.dueDate } : null;
}

function itemsOf(ctx: Ctx, deliveryId: string): ProgressItem[] {
  return ctx.store.all<ProgressItem>("progress").filter((p) => p.deliveryId === deliveryId);
}

function refreshNextAction(ctx: Ctx, d: Delivery): Delivery {
  const next = { ...d, nextAction: d.status === "active" ? nextActionOf(itemsOf(ctx, d.id)) : null, updatedAt: nowIso(ctx.clock), version: d.version + 1 };
  ctx.store.put("deliveries", next);
  return next;
}

/** 提供と進捗項目を作る（ZN-DLV-01, 8.1） */
export function createDelivery(
  ctx: Ctx,
  by: string,
  input: { customerId: string; productId: string; planId: string; dealId: string | null; startDate?: string; owner?: string | null; fields?: Record<string, string> },
): Delivery {
  const product = getProduct(ctx, input.productId);
  const plan = getPlan(ctx, input.planId);
  const start = input.startDate ?? today(ctx.clock);
  const end = endDateFor(start, plan.duration);
  const template = product.progressTemplates.find((t) => t.id === plan.progressTemplateId) ?? product.progressTemplates[0];
  if (!template) throw new ZnError(`「${product.name}」に進捗テンプレートがありません`);
  const now = nowIso(ctx.clock);
  const d: Delivery = {
    id: newId("dv", ctx.clock),
    customerId: input.customerId,
    productId: input.productId,
    planId: input.planId,
    dealId: input.dealId,
    owner: input.owner !== undefined ? input.owner : pickDeliveryOwner(ctx, input.productId),
    startDate: start,
    endDate: end,
    status: "active",
    nextAction: null,
    pauses: [],
    endReason: "",
    endedAt: null,
    satisfaction: null,
    fields: input.fields ?? {},
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const items: ProgressItem[] = planProgress(template, start, end).map((p) => ({
    id: newId("pg", ctx.clock),
    deliveryId: d.id,
    templateItemId: p.templateItemId,
    name: p.name,
    seq: p.seq,
    dueDate: p.dueDate,
    doneAt: null,
    status: "planned",
    completion: p.completion,
    record: null,
  }));
  for (const i of items) ctx.store.put("progress", i);
  d.nextAction = nextActionOf(items);
  ctx.store.put("deliveries", d);
  // 計上の基準日が「提供開始日」の商材は、ここで売上予定を作る
  if (product.revenueBasis === "delivery_start" && input.dealId) {
    const contract = ctx.store.all<Contract>("contracts").find((c) => c.dealId === input.dealId && c.status === "signed");
    const deal = ctx.store.get<Deal>("deals", input.dealId);
    const hasRevenue = ctx.store.all<Revenue>("revenues").some((r) => r.contractId === contract?.id);
    if (contract && deal && !hasRevenue) createRevenueForContract(ctx, contract, deal, { baseDate: start });
  }
  const customer = ctx.store.get<Customer>("customers", input.customerId);
  recordActivity(ctx, by, {
    customerId: input.customerId,
    type: "progress",
    deliveryId: d.id,
    dealId: input.dealId,
    result: `${label("delivery", product)}を開始`,
    note: `${plan.name}（${start}〜${end}）`,
  });
  if (d.owner) {
    ctx.notifier.send({
      kind: "delivery.assigned",
      to: [d.owner],
      title: `新しい${label("delivery", product)}：${customer?.name ?? ""}`,
      body: `${plan.name}（${start}〜${end}）の${label("deliveryOwner", product)}に割り当てられました。最初の予定：${d.nextAction?.title ?? ""} ${d.nextAction?.due ?? ""}`,
      productId: product.id,
    });
  }
  return d;
}

function getDelivery(ctx: Ctx, id: string): Delivery {
  const d = ctx.store.get<Delivery>("deliveries", id);
  if (!d) throw new ZnError("提供が見つかりません", "not_found");
  return d;
}

function requireEditable(ctx: Ctx, user: User, d: Delivery) {
  if (!can(user, "deliveries.edit") || !productAllowed(user, d.productId)) throw new ZnError("この提供を編集する権限がありません", "forbidden");
  if (user.role === "delivery" && d.owner !== user.email) throw new ZnError("自分の担当の提供のみ編集できます", "forbidden");
}

export type CellState = "done" | "planned" | "this_week" | "overdue" | "canceled" | "absent";

/** 進捗の表（ZN-DLV-03）：行に顧客、列に進捗項目 */
export function progressMatrix(ctx: Ctx, user: User, opts: { productId: string; owner?: "me" | "all" | string; status?: DeliveryStatus | "all" }) {
  const product = getProduct(ctx, opts.productId);
  const t = today(ctx.clock);
  const weekEnd = addDays(t, 6);
  const deliveries = visibleDeliveries(ctx, user).filter(
    (d) =>
      d.productId === opts.productId &&
      (opts.status === "all" || (opts.status ? d.status === opts.status : d.status === "active" || d.status === "paused")) &&
      (!opts.owner || opts.owner === "all" || (opts.owner === "me" ? d.owner === user.email : d.owner === opts.owner)),
  );
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c]));
  const plans = getSettings(ctx).plans;
  const allItems = ctx.store.all<ProgressItem>("progress");
  const activities = ctx.store.all<Activity>("activities");
  const columns: { key: string; name: string }[] = [];
  const colKey = (i: ProgressItem) => `${i.templateItemId}#${i.name}`;
  const rows = deliveries.map((d) => {
    const items = allItems.filter((i) => i.deliveryId === d.id).sort((a, b) => a.seq - b.seq);
    for (const i of items) if (!columns.some((c) => c.key === colKey(i))) columns.push({ key: colKey(i), name: i.name });
    const cells: Record<string, { id: string; state: CellState; dueDate: string; doneAt: string | null }> = {};
    for (const i of items) {
      let state: CellState = i.status === "done" ? (i.record?.attendance === "absent" ? "absent" : "done") : i.status === "canceled" ? "canceled" : "planned";
      if (state === "planned" && i.dueDate < t) state = "overdue";
      else if (state === "planned" && i.dueDate <= weekEnd) state = "this_week";
      cells[colKey(i)] = { id: i.id, state, dueDate: i.dueDate, doneAt: i.doneAt };
    }
    return {
      delivery: d,
      customer: { id: d.customerId, name: customers.get(d.customerId)?.name ?? "" },
      planName: plans.find((p) => p.id === d.planId)?.name ?? "",
      cells,
      risks: riskFlags(d, items, activities.filter((a) => a.customerId === d.customerId), t),
      progressRate: (() => {
        const act = items.filter((i) => i.status !== "canceled");
        return act.length ? Math.round((act.filter((i) => i.status === "done").length / act.length) * 100) : 0;
      })(),
    };
  });
  // 列は、代表的な並び（最初に出た順）。繰り返し項目は回数順
  return { product: { id: product.id, name: product.name, labels: product.dictionary }, columns, rows };
}

/** 遅れとリスクの検知（ZN-DLV-06） */
export function riskFlags(d: Delivery, items: ProgressItem[], activities: Activity[], t: string): string[] {
  if (d.status !== "active") return [];
  const flags: string[] = [];
  const overdue = items.filter((i) => i.status === "planned" && i.dueDate < t).length;
  if (overdue) flags.push(`予定日を過ぎた項目が${overdue}件`);
  const done = items.filter((i) => i.status === "done" && i.completion === "session").sort((a, b) => ((a.doneAt ?? "") < (b.doneAt ?? "") ? -1 : 1));
  const last2 = done.slice(-2);
  if (last2.length === 2 && last2.every((i) => i.record?.attendance === "absent")) flags.push("欠席が2回続いています");
  const contacts = [
    d.startDate,
    ...activities.filter((a) => a.type !== "system").map((a) => a.at.slice(0, 10)),
    ...items.filter((i) => i.doneAt && i.record?.attendance !== "absent").map((i) => i.doneAt!),
  ].sort();
  const lastContact = contacts[contacts.length - 1];
  if (lastContact && diffDays(lastContact, t) >= 14) flags.push(`最後の接触から${diffDays(lastContact, t)}日`);
  return flags;
}

/** セッションの記録（ZN-DLV-05）：実施日・出欠・内容・宿題・次回の予定を1画面で */
export function recordSession(
  ctx: Ctx,
  user: User,
  itemId: string,
  input: { date: string; attendance: "attended" | "absent" | "rescheduled"; content?: string; homework?: string; nextDate?: string | null },
): { item: ProgressItem; delivery: Delivery } {
  const item = ctx.store.get<ProgressItem>("progress", itemId);
  if (!item) throw new ZnError("進捗項目が見つかりません", "not_found");
  const d = getDelivery(ctx, item.deliveryId);
  requireEditable(ctx, user, d);
  if (item.status !== "planned") throw new ZnError("この項目は完了済みか取り消されています", "conflict");
  let updated: ProgressItem;
  if (input.attendance === "rescheduled") {
    if (!input.nextDate) throw new ZnError("振替の日付を入力してください");
    updated = { ...item, dueDate: input.nextDate, record: { attendance: "rescheduled", content: input.content ?? "" } };
  } else {
    updated = {
      ...item,
      status: "done",
      doneAt: input.date,
      record: { attendance: input.attendance, content: input.content ?? "", homework: input.homework ?? "" },
    };
  }
  ctx.store.put("progress", updated);
  // 次回の予定を設定：次の未完了の項目の予定日を更新する
  if (input.nextDate && input.attendance !== "rescheduled") {
    const next = itemsOf(ctx, d.id)
      .filter((i) => i.status === "planned" && i.id !== item.id)
      .sort((a, b) => a.seq - b.seq)[0];
    if (next) ctx.store.put("progress", { ...next, dueDate: input.nextDate });
  }
  const product = getProduct(ctx, d.productId);
  recordActivity(ctx, user.email, {
    customerId: d.customerId,
    deliveryId: d.id,
    type: "progress",
    result: `${item.name}：${input.attendance === "attended" ? "実施" : input.attendance === "absent" ? "欠席" : "振替"}`,
    note: [input.content, input.homework ? `宿題：${input.homework}` : "", input.nextDate ? `次回：${input.nextDate}` : ""].filter(Boolean).join("\n"),
    at: `${input.date}T00:00:00.000Z`,
  });
  audit(ctx, user, "progress.record", "progress", itemId, { attendance: input.attendance, product: product.id });
  return { item: updated, delivery: refreshNextAction(ctx, d) };
}

/** 記録を伴わない項目の完了（日付・チェック） */
export function completeItem(ctx: Ctx, user: User, itemId: string, date: string): ProgressItem {
  const item = ctx.store.get<ProgressItem>("progress", itemId);
  if (!item) throw new ZnError("進捗項目が見つかりません", "not_found");
  const d = getDelivery(ctx, item.deliveryId);
  requireEditable(ctx, user, d);
  const updated: ProgressItem = { ...item, status: "done", doneAt: date };
  ctx.store.put("progress", updated);
  recordActivity(ctx, user.email, { customerId: d.customerId, deliveryId: d.id, type: "progress", result: `${item.name} 完了`, at: `${date}T00:00:00.000Z` });
  refreshNextAction(ctx, d);
  return updated;
}

export function reopenItem(ctx: Ctx, user: User, itemId: string): ProgressItem {
  const item = ctx.store.get<ProgressItem>("progress", itemId);
  if (!item) throw new ZnError("進捗項目が見つかりません", "not_found");
  const d = getDelivery(ctx, item.deliveryId);
  requireEditable(ctx, user, d);
  const updated: ProgressItem = { ...item, status: "planned", doneAt: null, record: null };
  ctx.store.put("progress", updated);
  refreshNextAction(ctx, d);
  return updated;
}

/** 休止（ZN-DLV-08）：休止期間の分だけ予定日を後ろにずらし、終了日も延ばす */
export function pauseDelivery(ctx: Ctx, user: User, id: string, from: string, to: string, reason: string): Delivery {
  const d = getDelivery(ctx, id);
  requireEditable(ctx, user, d);
  const days = diffDays(from, to) + 1;
  if (days <= 0) throw new ZnError("休止の期間が正しくありません");
  for (const i of itemsOf(ctx, id)) {
    if (i.status === "planned" && i.dueDate >= from) ctx.store.put("progress", { ...i, dueDate: addDays(i.dueDate, days) });
  }
  const t = today(ctx.clock);
  const next: Delivery = {
    ...d,
    endDate: addDays(d.endDate, days),
    pauses: [...d.pauses, { from, to, reason }],
    status: from <= t && t <= to ? "paused" : d.status,
  };
  ctx.store.put("deliveries", next);
  recordActivity(ctx, user.email, { customerId: d.customerId, deliveryId: id, type: "system", result: "休止", note: `${from}〜${to}（${days}日）${reason}` });
  audit(ctx, user, "delivery.pause", "deliveries", id, { from, to, reason });
  return refreshNextAction(ctx, next);
}

export function resumeDelivery(ctx: Ctx, user: User, id: string): Delivery {
  const d = getDelivery(ctx, id);
  requireEditable(ctx, user, d);
  if (d.status !== "paused") return d;
  return refreshNextAction(ctx, { ...d, status: "active" });
}

/** 延長：終了日を延ばし、繰り返し項目を追加する */
export function extendDelivery(ctx: Ctx, user: User, id: string, newEndDate: string): Delivery {
  const d = getDelivery(ctx, id);
  requireEditable(ctx, user, d);
  if (newEndDate <= d.endDate) throw new ZnError("新しい終了日は現在の終了日より後にしてください");
  const product = getProduct(ctx, d.productId);
  const plan = getPlan(ctx, d.planId);
  const template = product.progressTemplates.find((t) => t.id === plan.progressTemplateId) ?? product.progressTemplates[0]!;
  const items = itemsOf(ctx, id);
  const planned = planProgress(template, d.startDate, newEndDate);
  let seq = Math.max(0, ...items.map((i) => i.seq)) + 1;
  for (const p of planned) {
    const tItem = template.items.find((x) => x.id === p.templateItemId);
    if (tItem?.anchor === "end") {
      // 終了日基準の項目（修了など）は日付を動かす
      for (const i of items.filter((x) => x.templateItemId === p.templateItemId && x.status === "planned")) ctx.store.put("progress", { ...i, dueDate: p.dueDate });
      continue;
    }
    if (tItem?.repeat !== "none" && p.dueDate >= d.endDate && !items.some((i) => i.templateItemId === p.templateItemId && i.name === p.name)) {
      ctx.store.put("progress", {
        id: newId("pg", ctx.clock),
        deliveryId: id,
        templateItemId: p.templateItemId,
        name: p.name,
        seq: seq++,
        dueDate: p.dueDate,
        doneAt: null,
        status: "planned",
        completion: p.completion,
        record: null,
      });
    }
  }
  const next: Delivery = { ...d, endDate: newEndDate };
  ctx.store.put("deliveries", next);
  recordActivity(ctx, user.email, { customerId: d.customerId, deliveryId: id, type: "system", result: "延長", note: `終了日 ${d.endDate} → ${newEndDate}` });
  audit(ctx, user, "delivery.extend", "deliveries", id, { from: d.endDate, to: newEndDate });
  return refreshNextAction(ctx, next);
}

/** 修了・解約・プラン変更（ZN-DLV-09）：残りの進捗項目を取り消す */
export function finishDelivery(
  ctx: Ctx,
  user: User,
  id: string,
  input: { status: "completed" | "canceled" | "plan_changed"; date: string; reason?: string; satisfaction?: { score: number; comment: string } | null },
): Delivery {
  const d = getDelivery(ctx, id);
  requireEditable(ctx, user, d);
  if (d.status !== "active" && d.status !== "paused") throw new ZnError("この提供はすでに終了しています", "conflict");
  if (input.status !== "completed" && !input.reason?.trim()) throw new ZnError("理由を入力してください");
  let canceled = 0;
  for (const i of itemsOf(ctx, id)) {
    if (i.status === "planned") {
      const isFinishItem = input.status === "completed" && i.completion === "check" && i.dueDate >= d.endDate;
      ctx.store.put("progress", isFinishItem ? { ...i, status: "done", doneAt: input.date } : { ...i, status: "canceled" });
      if (!isFinishItem) canceled++;
    }
  }
  const next: Delivery = {
    ...d,
    status: input.status,
    endedAt: input.date,
    endReason: input.reason?.trim() ?? "",
    satisfaction: input.satisfaction ?? d.satisfaction ?? null,
    nextAction: null,
    updatedAt: nowIso(ctx.clock),
    version: d.version + 1,
  };
  ctx.store.put("deliveries", next);
  if (input.status === "canceled") {
    // 月額の売上は解約で止める
    stopFutureRevenues(ctx, user.email, d.dealId, d.customerId, d.productId, monthOf(input.date));
  }
  const labels = { completed: "修了", canceled: "解約", plan_changed: "プラン変更" } as const;
  recordActivity(ctx, user.email, { customerId: d.customerId, deliveryId: id, type: "progress", result: labels[input.status], note: `${input.reason ?? ""}（取り消した予定 ${canceled}件）`.trim() });
  audit(ctx, user, `delivery.${input.status}`, "deliveries", id, { reason: input.reason ?? "", canceled });
  return next;
}

/** 担当の引き継ぎ（ZN-DLV-10）：引き継ぎメモを必須にして新しい担当者に知らせる */
export function changeDeliveryOwner(ctx: Ctx, user: User, id: string, newOwner: string, note: string): Delivery {
  const d = getDelivery(ctx, id);
  if (!can(user, "assign.change") || !productAllowed(user, d.productId)) throw new ZnError("担当を変更する権限がありません", "forbidden");
  if (!note.trim()) throw new ZnError("引き継ぎメモを入力してください");
  const next: Delivery = { ...d, owner: newOwner, updatedAt: nowIso(ctx.clock), version: d.version + 1 };
  ctx.store.put("deliveries", next);
  const customer = ctx.store.get<Customer>("customers", d.customerId);
  recordActivity(ctx, user.email, { customerId: d.customerId, deliveryId: id, type: "memo", result: "担当の引き継ぎ", note: `${d.owner ?? "（未設定）"} → ${newOwner}\n${note}` });
  ctx.notifier.send({ kind: "delivery.handover", to: [newOwner], title: `引き継ぎ：${customer?.name ?? ""}`, body: note, productId: d.productId });
  audit(ctx, user, "delivery.owner", "deliveries", id, { from: d.owner, to: newOwner });
  return next;
}

export function deliveryDetail(ctx: Ctx, user: User, id: string) {
  const d = getDelivery(ctx, id);
  if (!visibleDeliveries(ctx, user, [d]).length) throw new ZnError("この提供を見る権限がありません", "forbidden");
  const items = itemsOf(ctx, id).sort((a, b) => a.seq - b.seq);
  const customer = ctx.store.get<Customer>("customers", d.customerId);
  const deal = d.dealId ? ctx.store.get<Deal>("deals", d.dealId) : null;
  return { delivery: d, items, customer, deal, plan: getPlan(ctx, d.planId) };
}
