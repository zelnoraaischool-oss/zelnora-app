import { audit, type Ctx } from "./context";
import { dateOfIso, nowIso, today } from "./dates";
import { findDuplicateGroups } from "./dedupe";
import { can, productAllowed } from "./permissions";
import { canSeeCustomer, maskCustomer, visibleCustomerIds, visibleDeals, visibleDeliveries, visibleRevenues } from "./scope";
import { getSettings } from "./settings";
import type {
  Activity,
  ActivityType,
  Contract,
  Customer,
  CustomerStatus,
  Deal,
  Delivery,
  NextAction,
  ProgressItem,
  Registration,
  Revenue,
  User,
} from "./types";
import { newId, normalizeEmail, normalizePhone, ZnError } from "./util";

export interface CustomerInput {
  name: string;
  kana?: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status?: CustomerStatus;
  tags?: string[];
  salesOwner?: string | null;
  note?: string;
  custom?: Record<string, string>;
}

export function newCustomer(ctx: Ctx, input: CustomerInput): Customer {
  const name = (input.name ?? "").trim();
  if (!name) throw new ZnError("氏名を入力してください");
  const now = nowIso(ctx.clock);
  return {
    id: newId("cu", ctx.clock),
    name,
    kana: input.kana?.trim() ?? "",
    email: normalizeEmail(input.email),
    phone: (input.phone ?? "").trim(),
    company: input.company?.trim() ?? "",
    source: input.source?.trim() ?? "",
    status: input.status ?? "lead",
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    salesOwner: input.salesOwner ?? null,
    note: input.note ?? "",
    custom: input.custom ?? {},
    mergedInto: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function getCustomer(ctx: Ctx, id: string): Customer {
  const c = ctx.store.get<Customer>("customers", id);
  if (!c) throw new ZnError("顧客が見つかりません", "not_found");
  return c;
}

function requireVisible(ctx: Ctx, user: User, id: string): Customer {
  const c = getCustomer(ctx, id);
  if (!canSeeCustomer(ctx, user, id)) throw new ZnError("この顧客を見る権限がありません", "forbidden");
  return c;
}

export function createCustomer(ctx: Ctx, user: User, input: CustomerInput): Customer {
  if (!can(user, "customers.edit")) throw new ZnError("顧客を登録する権限がありません", "forbidden");
  const c = newCustomer(ctx, { ...input, salesOwner: input.salesOwner ?? (user.role === "sales" ? user.email : null) });
  ctx.store.put("customers", c);
  audit(ctx, user, "customer.create", "customers", c.id);
  return c;
}

/** 顧客の更新。expectedVersion が古ければ衝突として現在の値を返す（ZN-CUS-05） */
export function updateCustomer(ctx: Ctx, user: User, id: string, patch: Partial<CustomerInput>, expectedVersion?: number): Customer {
  if (!can(user, "customers.edit")) throw new ZnError("顧客を編集する権限がありません", "forbidden");
  const c = requireVisible(ctx, user, id);
  if (expectedVersion !== undefined && expectedVersion !== c.version) {
    throw new ZnError("他の人が先に更新しました。最新の内容を確認してください", "conflict", maskCustomer(ctx, user, c));
  }
  if (patch.name !== undefined && !patch.name.trim()) throw new ZnError("氏名を入力してください");
  const next: Customer = {
    ...c,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.kana !== undefined ? { kana: patch.kana.trim() } : {}),
    ...(patch.email !== undefined ? { email: normalizeEmail(patch.email) } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone.trim() } : {}),
    ...(patch.company !== undefined ? { company: patch.company.trim() } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags.map((t) => t.trim()).filter(Boolean) } : {}),
    ...(patch.salesOwner !== undefined ? { salesOwner: patch.salesOwner } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.custom !== undefined ? { custom: { ...c.custom, ...patch.custom } } : {}),
    updatedAt: nowIso(ctx.clock),
    version: c.version + 1,
  };
  ctx.store.put("customers", next);
  audit(ctx, user, "customer.update", "customers", id, { fields: Object.keys(patch) });
  return maskCustomer(ctx, user, next);
}

export interface CustomerFilter {
  q?: string;
  productId?: string;
  planId?: string;
  status?: CustomerStatus | "";
  owner?: string;
  stageId?: string;
  tags?: string[];
  from?: string;
  to?: string;
  custom?: Record<string, string>;
  /** すべて満たす／いずれか（ZN-CUS-03） */
  mode?: "all" | "any";
}

export interface CustomerRow extends Customer {
  productIds: string[];
  planIds: string[];
  stages: { dealId: string; productId: string; stageId: string }[];
  nextAction: (NextAction & { source: "deal" | "delivery"; refId: string }) | null;
  lastActivityAt: string | null;
}

export function listCustomers(ctx: Ctx, user: User, filter: CustomerFilter = {}): CustomerRow[] {
  const visible = visibleCustomerIds(ctx, user);
  const deals = visibleDeals(ctx, user);
  const deliveries = visibleDeliveries(ctx, user);
  const activities = ctx.store.all<Activity>("activities");
  const lastAct = new Map<string, string>();
  for (const a of activities) if ((lastAct.get(a.customerId) ?? "") < a.at) lastAct.set(a.customerId, a.at);
  const rows: CustomerRow[] = ctx.store
    .all<Customer>("customers")
    .filter((c) => !c.mergedInto && (visible === "all" || visible.has(c.id)))
    .map((c) => {
      const ds = deals.filter((d) => d.customerId === c.id);
      const vs = deliveries.filter((d) => d.customerId === c.id);
      const actions = [
        ...ds.filter((d) => d.status === "open" && d.nextAction).map((d) => ({ ...d.nextAction!, source: "deal" as const, refId: d.id })),
        ...vs.filter((d) => d.status === "active" && d.nextAction).map((d) => ({ ...d.nextAction!, source: "delivery" as const, refId: d.id })),
      ].sort((a, b) => (a.due < b.due ? -1 : 1));
      return {
        ...maskCustomer(ctx, user, c),
        productIds: [...new Set([...ds.map((d) => d.productId), ...vs.map((d) => d.productId)])],
        planIds: [...new Set([...ds.map((d) => d.planId).filter((x): x is string => !!x), ...vs.map((d) => d.planId)])],
        stages: ds.map((d) => ({ dealId: d.id, productId: d.productId, stageId: d.stageId })),
        nextAction: actions[0] ?? null,
        lastActivityAt: lastAct.get(c.id) ?? null,
      };
    });
  const conds: ((r: CustomerRow) => boolean)[] = [];
  if (filter.productId) conds.push((r) => r.productIds.includes(filter.productId!));
  if (filter.planId) conds.push((r) => r.planIds.includes(filter.planId!));
  if (filter.status) conds.push((r) => r.status === filter.status);
  if (filter.owner) conds.push((r) => r.salesOwner === filter.owner || deals.some((d) => d.customerId === r.id && d.owner === filter.owner));
  if (filter.stageId) conds.push((r) => r.stages.some((s) => s.stageId === filter.stageId));
  if (filter.tags?.length) conds.push((r) => filter.tags!.some((t) => r.tags.includes(t)));
  if (filter.from) conds.push((r) => dateOfIso(r.createdAt) >= filter.from!);
  if (filter.to) conds.push((r) => dateOfIso(r.createdAt) <= filter.to!);
  for (const [k, v] of Object.entries(filter.custom ?? {})) if (v) conds.push((r) => (r.custom[k] ?? "").includes(v));
  const q = filter.q?.trim().toLowerCase();
  let out = rows;
  if (conds.length) out = out.filter((r) => (filter.mode === "any" ? conds.some((c) => c(r)) : conds.every((c) => c(r))));
  if (q) {
    const qp = normalizePhone(q);
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.kana.toLowerCase().includes(q) ||
        r.email.includes(q) ||
        r.company.toLowerCase().includes(q) ||
        (qp.length >= 4 && normalizePhone(r.phone).includes(qp)),
    );
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 一括操作（ZN-CUS-06） */
export function bulkUpdateCustomers(ctx: Ctx, user: User, ids: string[], patch: { salesOwner?: string | null; addTags?: string[]; status?: CustomerStatus }): number {
  if (!can(user, "customers.edit")) throw new ZnError("顧客を編集する権限がありません", "forbidden");
  if (patch.salesOwner !== undefined && !can(user, "assign.change")) throw new ZnError("担当を変更する権限がありません", "forbidden");
  let n = 0;
  for (const id of ids) {
    const c = requireVisible(ctx, user, id);
    ctx.store.put("customers", {
      ...c,
      ...(patch.salesOwner !== undefined ? { salesOwner: patch.salesOwner } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      tags: patch.addTags ? [...new Set([...c.tags, ...patch.addTags.filter(Boolean)])] : c.tags,
      updatedAt: nowIso(ctx.clock),
      version: c.version + 1,
    });
    n++;
  }
  audit(ctx, user, "customer.bulk_update", "customers", ids.join(","), patch);
  return n;
}

export function addActivity(
  ctx: Ctx,
  user: User,
  input: { customerId: string; type: ActivityType; result?: string; durationMin?: number | null; note?: string; dealId?: string | null; deliveryId?: string | null; at?: string },
): Activity {
  if (!can(user, "customers.edit")) throw new ZnError("活動を記録する権限がありません", "forbidden");
  requireVisible(ctx, user, input.customerId);
  return recordActivity(ctx, user.email, input);
}

/** 権限の確認なしで活動を記録する（自動処理用） */
export function recordActivity(
  ctx: Ctx,
  by: string,
  input: { customerId: string; type: ActivityType; result?: string; durationMin?: number | null; note?: string; dealId?: string | null; deliveryId?: string | null; at?: string },
): Activity {
  const a: Activity = {
    id: newId("ac", ctx.clock),
    customerId: input.customerId,
    dealId: input.dealId ?? null,
    deliveryId: input.deliveryId ?? null,
    type: input.type,
    result: input.result ?? "",
    durationMin: input.durationMin ?? null,
    note: input.note ?? "",
    at: input.at ?? nowIso(ctx.clock),
    by,
  };
  ctx.store.put("activities", a);
  return a;
}

export interface TimelineEntry {
  at: string;
  type: ActivityType;
  title: string;
  detail: string;
  by: string;
  ref: { entity: string; id: string };
}

/** 顧客詳細：時系列と関連カード（6.3） */
export function customerDetail(ctx: Ctx, user: User, id: string) {
  const c = requireVisible(ctx, user, id);
  const deals = visibleDeals(ctx, user).filter((d) => d.customerId === id);
  const deliveries = visibleDeliveries(ctx, user).filter((d) => d.customerId === id);
  const deliveryIds = new Set(deliveries.map((d) => d.id));
  const progress = ctx.store.all<ProgressItem>("progress").filter((p) => deliveryIds.has(p.deliveryId));
  const contracts = ctx.store.all<Contract>("contracts").filter((x) => x.customerId === id && productAllowed(user, x.productId));
  const registrations = ctx.store.all<Registration>("registrations").filter((x) => x.customerId === id && productAllowed(user, x.productId));
  const revenues = visibleRevenues(ctx, user).filter((r) => r.customerId === id);
  const activities = ctx.store.all<Activity>("activities").filter((a) => a.customerId === id);
  const timeline: TimelineEntry[] = [
    ...activities.map((a) => ({
      at: a.at,
      type: a.type,
      title: a.result || a.type,
      detail: a.note,
      by: a.by,
      ref: { entity: "activities", id: a.id },
    })),
    ...contracts.map((x) => ({
      at: `${x.signedAt}T00:00:00.000Z`,
      type: "contract" as const,
      title: "契約の締結",
      detail: `${x.amountIncl.toLocaleString("ja-JP")}円（${x.paymentMethod}）`,
      by: "",
      ref: { entity: "contracts", id: x.id },
    })),
    ...registrations.map((x) => ({
      at: x.receivedAt,
      type: "form" as const,
      title: "フォーム回答",
      detail: x.message,
      by: "",
      ref: { entity: "registrations", id: x.id },
    })),
    ...progress
      .filter((p) => p.status === "done" && p.doneAt)
      .map((p) => ({
        at: `${p.doneAt}T00:00:00.000Z`,
        type: "progress" as const,
        title: `${p.name} 完了`,
        detail: p.record?.content ?? "",
        by: "",
        ref: { entity: "progress", id: p.id },
      })),
    ...revenues.map((r) => ({
      at: r.createdAt,
      type: "revenue" as const,
      title: r.kind === "sale" ? `売上（${r.month}）` : `${r.kind === "refund" ? "返金" : r.kind === "discount" ? "値引き" : "調整"}（${r.month}）`,
      detail: `${r.amountIncl.toLocaleString("ja-JP")}円`,
      by: "",
      ref: { entity: "revenues", id: r.id },
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const t = today(ctx.clock);
  const revenueTotal = revenues.filter((r) => r.status !== "canceled").reduce((s, r) => s + r.amountIncl, 0);
  const unpaid = revenues
    .filter((r) => r.kind === "sale" && r.status !== "canceled" && !r.paidAt)
    .reduce((s, r) => s + r.amountIncl, 0);
  return {
    customer: maskCustomer(ctx, user, c),
    deals,
    deliveries: deliveries.map((d) => {
      const items = progress.filter((p) => p.deliveryId === d.id).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      const active = items.filter((i) => i.status !== "canceled");
      const done = active.filter((i) => i.status === "done").length;
      return {
        ...d,
        progressRate: active.length ? Math.round((done / active.length) * 100) : 0,
        nextItem: active.find((i) => i.status === "planned") ?? null,
        overdue: active.filter((i) => i.status === "planned" && i.dueDate < t).length,
      };
    }),
    contracts,
    registrations,
    revenues,
    revenueTotal,
    unpaid,
    timeline,
  };
}

export function duplicateCandidates(ctx: Ctx, user: User) {
  if (!can(user, "customers.merge")) throw new ZnError("統合の権限がありません", "forbidden");
  const customers = ctx.store.all<Customer>("customers");
  return findDuplicateGroups(customers).map((g) => ({ ...g, customers: g.customerIds.map((id) => customers.find((c) => c.id === id)!) }));
}

type MergeField = "name" | "kana" | "email" | "phone" | "company" | "source" | "status" | "salesOwner" | "note";

/**
 * 顧客の統合（ZN-CUS-07）。項目ごとに残す値を選び、商談・提供・売上などを付け替える。
 * 統合前の状態は監査ログに残す。
 */
export function mergeCustomers(ctx: Ctx, user: User, primaryId: string, secondaryId: string, pick: Partial<Record<MergeField, "primary" | "secondary">> = {}): Customer {
  if (!can(user, "customers.merge")) throw new ZnError("統合の権限がありません", "forbidden");
  if (primaryId === secondaryId) throw new ZnError("同じ顧客は統合できません");
  const a = getCustomer(ctx, primaryId);
  const b = getCustomer(ctx, secondaryId);
  if (a.mergedInto || b.mergedInto) throw new ZnError("すでに統合された顧客です", "conflict");
  const merged: Customer = { ...a };
  for (const f of ["name", "kana", "email", "phone", "company", "source", "status", "salesOwner", "note"] as MergeField[]) {
    const choose = pick[f] ?? (a[f] ? "primary" : "secondary");
    (merged as unknown as Record<string, unknown>)[f] = choose === "secondary" ? b[f] : a[f];
  }
  merged.tags = [...new Set([...a.tags, ...b.tags])];
  merged.custom = { ...b.custom, ...a.custom };
  merged.updatedAt = nowIso(ctx.clock);
  merged.version = a.version + 1;
  const moved: Record<string, number> = {};
  const move = <T extends { id: string; customerId: string | null }>(entity: "deals" | "deliveries" | "revenues" | "activities" | "contracts" | "registrations") => {
    let n = 0;
    for (const row of ctx.store.all<T>(entity)) {
      if (row.customerId === secondaryId) {
        ctx.store.put(entity, { ...row, customerId: primaryId });
        n++;
      }
    }
    moved[entity] = n;
  };
  move<Deal>("deals");
  move<Delivery>("deliveries");
  move<Revenue>("revenues");
  move<Activity>("activities");
  move<Contract>("contracts");
  move<Registration>("registrations");
  ctx.store.put("customers", merged);
  ctx.store.put("customers", { ...b, mergedInto: primaryId, updatedAt: nowIso(ctx.clock), version: b.version + 1 });
  audit(ctx, user, "customer.merge", "customers", primaryId, { before: { primary: a, secondary: b }, moved });
  recordActivity(ctx, user.email, { customerId: primaryId, type: "system", result: "顧客を統合", note: `${b.name}（${b.email || b.phone}）を統合しました` });
  return merged;
}

/** 本人データの書き出し（ZN-CUS-14） */
export function exportCustomerData(ctx: Ctx, user: User, id: string): string {
  if (!can(user, "customers.merge")) throw new ZnError("書き出しの権限がありません", "forbidden");
  const c = getCustomer(ctx, id);
  const byCustomer = <T extends { customerId: string | null }>(e: "deals" | "deliveries" | "revenues" | "activities" | "contracts" | "registrations") =>
    ctx.store.all<T>(e).filter((r) => r.customerId === id);
  const deliveries = byCustomer<Delivery>("deliveries");
  const ids = new Set(deliveries.map((d) => d.id));
  audit(ctx, user, "customer.export", "customers", id);
  return JSON.stringify(
    {
      exportedAt: nowIso(ctx.clock),
      organization: getSettings(ctx).organizationName,
      customer: c,
      deals: byCustomer("deals"),
      contracts: byCustomer("contracts"),
      registrations: byCustomer("registrations"),
      deliveries,
      progress: ctx.store.all<ProgressItem>("progress").filter((p) => ids.has(p.deliveryId)),
      revenues: byCustomer("revenues"),
      activities: byCustomer("activities"),
    },
    null,
    2,
  );
}
