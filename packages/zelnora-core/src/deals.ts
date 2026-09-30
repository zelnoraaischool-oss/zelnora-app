import { audit, type Ctx } from "./context";
import { createCustomer, type CustomerInput, getCustomer, newCustomer, recordActivity } from "./customers";
import { addDays, dateOfIso, diffDays, isDate, nowIso, today } from "./dates";
import { createDelivery } from "./deliveries";
import { matchCustomer } from "./dedupe";
import { label } from "./dictionary";
import { can, productAllowed } from "./permissions";
import { priceAt } from "./revenue";
import { createRevenueForContract } from "./revenues";
import { visibleDeals } from "./scope";
import { firstStageOfKind, getPlan, getProduct, getSettings, stageById } from "./settings";
import type { Contract, Customer, Deal, Delivery, NextAction, Product, Stage, StageKind, User } from "./types";
import { newId, ZnError } from "./util";

/** 次のアクションが必須の段階（進行中の商談は必ず1つ持つ：ZN-SALES-05） */
export const ACTION_REQUIRED_KINDS: StageKind[] = ["new", "contact", "meeting", "contract", "hold"];

const TOP_LEVEL_FIELDS = ["planId", "amount", "paymentMethod"] as const;

export function fieldLabel(product: Product, key: string): string {
  if (key === "planId") return label("plan", product);
  if (key === "amount") return "金額";
  if (key === "paymentMethod") return "支払い方法";
  return product.customFields.deal.find((f) => f.key === key)?.label ?? key;
}

/** 営業担当の割り当て（ZN-SALES-09） */
export function pickSalesOwner(ctx: Ctx, product: Product, requested?: string | null): string | null {
  if (requested) return requested;
  if (product.salesAssignment === "default") return product.defaultSalesOwner ?? null;
  if (product.salesAssignment === "round_robin") {
    const users = ctx.store.all<User>("users").filter((u) => u.active && u.role === "sales" && u.productIds.includes(product.id));
    if (!users.length) return product.defaultSalesOwner ?? null;
    const deals = ctx.store.all<Deal>("deals").filter((d) => d.productId === product.id);
    const lastAssigned = (email: string) => deals.filter((d) => d.owner === email).reduce((m, d) => (d.createdAt > m ? d.createdAt : m), "");
    return [...users].sort((a, b) => lastAssigned(a.email).localeCompare(lastAssigned(b.email)) || a.email.localeCompare(b.email))[0]!.email;
  }
  return product.defaultSalesOwner ?? null;
}

function defaultNextAction(ctx: Ctx, stage: Stage, fields: Record<string, string>): NextAction | null {
  const d = stage.defaultNextAction;
  if (!d) return null;
  let base = today(ctx.clock);
  if (d.fromField && fields[d.fromField]) base = dateOfIso(fields[d.fromField]!.length > 10 ? new Date(fields[d.fromField]!).toISOString() : fields[d.fromField]!);
  return { title: d.title, due: addDays(base, d.days) };
}

export interface LeadInput {
  customer: CustomerInput & { id?: string };
  productId: string;
  planId?: string | null;
  amount?: number | null;
  source?: string;
  owner?: string | null;
  note?: string;
}

/** リードの登録（ZN-SALES-08）：同じメールの顧客がいればまとめる */
export function createLead(ctx: Ctx, user: User, input: LeadInput): { customer: Customer; deal: Deal } {
  if (!can(user, "deals.edit")) throw new ZnError("商談を登録する権限がありません", "forbidden");
  if (!productAllowed(user, input.productId)) throw new ZnError("担当外の商材です", "forbidden");
  const product = getProduct(ctx, input.productId);
  if (product.status !== "active") throw new ZnError("停止中の商材には登録できません");
  const stage = firstStageOfKind(product, "new") ?? [...product.stages].sort((a, b) => a.order - b.order)[0]!;
  let customer: Customer;
  if (input.customer.id) customer = getCustomer(ctx, input.customer.id);
  else {
    const found = matchCustomer(ctx.store.all<Customer>("customers"), input.customer, ["email"]);
    customer = found[0] ?? createCustomer(ctx, user, { ...input.customer, source: input.customer.source ?? input.source });
  }
  const owner = pickSalesOwner(ctx, product, input.owner ?? (user.role === "sales" ? user.email : null));
  const now = nowIso(ctx.clock);
  const plan = input.planId ? getPlan(ctx, input.planId) : null;
  if (plan && plan.status !== "active") throw new ZnError("停止中のプランは選べません");
  const deal: Deal = {
    id: newId("dl", ctx.clock),
    customerId: customer.id,
    productId: product.id,
    planId: plan?.id ?? null,
    stageId: stage.id,
    owner,
    amount: input.amount ?? (plan ? priceAt(plan, today(ctx.clock)).incl : null),
    paymentMethod: null,
    fields: {},
    nextAction: defaultNextAction(ctx, stage, {}),
    stageEnteredAt: now,
    history: [{ stageId: stage.id, at: now, by: user.email }],
    status: "open",
    source: input.source ?? customer.source ?? "",
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  ctx.store.put("deals", deal);
  if (!customer.salesOwner && owner) ctx.store.put("customers", { ...customer, salesOwner: owner, updatedAt: now, version: customer.version + 1 });
  recordActivity(ctx, user.email, { customerId: customer.id, dealId: deal.id, type: "stage", result: `${label("lead", product)}として登録（${stage.name}）`, note: input.note ?? "" });
  if (owner && owner !== user.email) {
    ctx.notifier.send({ kind: "deal.assigned", to: [owner], title: `新しい${label("lead", product)}：${customer.name}`, body: `次のアクション：${deal.nextAction?.title ?? ""}（${deal.nextAction?.due ?? ""}）`, productId: product.id });
  }
  audit(ctx, user, "deal.create", "deals", deal.id, { productId: product.id, owner });
  return { customer, deal };
}

export function getDeal(ctx: Ctx, id: string): Deal {
  const d = ctx.store.get<Deal>("deals", id);
  if (!d) throw new ZnError("商談が見つかりません", "not_found");
  return d;
}

function requireEditable(ctx: Ctx, user: User, deal: Deal) {
  if (!can(user, "deals.edit") || !productAllowed(user, deal.productId)) throw new ZnError("この商談を編集する権限がありません", "forbidden");
  if (user.role === "sales" && deal.owner !== user.email) throw new ZnError("自分の担当の商談のみ編集できます", "forbidden");
}

function valueOf(deal: Deal, key: string): unknown {
  if (key === "planId") return deal.planId;
  if (key === "amount") return deal.amount;
  if (key === "paymentMethod") return deal.paymentMethod;
  return deal.fields[key];
}

/** 段階を移すのに足りない項目（ZN-SALES-04） */
export function missingFields(product: Product, deal: Deal, stage: Stage): { key: string; label: string }[] {
  return stage.requiredFields.filter((k) => {
    const v = valueOf(deal, k);
    return v === null || v === undefined || v === "";
  }).map((k) => ({ key: k, label: fieldLabel(product, k) }));
}

export interface MoveInput {
  stageId: string;
  planId?: string | null;
  amount?: number | null;
  paymentMethod?: string | null;
  fields?: Record<string, string>;
  nextAction?: NextAction | null;
  note?: string;
  /** 成約時の締結日（既定は今日） */
  signedAt?: string;
}

export interface MoveResult {
  deal: Deal;
  contract?: Contract;
  delivery?: Delivery;
  registrationUrl?: string | null;
}

/**
 * 段階の移動と、段階の種類ごとの自動処理（2.3, 5.3）。
 */
export function moveStage(ctx: Ctx, user: User, dealId: string, input: MoveInput): MoveResult {
  const deal = getDeal(ctx, dealId);
  requireEditable(ctx, user, deal);
  const product = getProduct(ctx, deal.productId);
  const stage = stageById(product, input.stageId);
  const from = stageById(product, deal.stageId);
  const now = nowIso(ctx.clock);
  const next: Deal = {
    ...deal,
    planId: input.planId !== undefined ? input.planId : deal.planId,
    amount: input.amount !== undefined ? input.amount : deal.amount,
    paymentMethod: input.paymentMethod !== undefined ? input.paymentMethod : deal.paymentMethod,
    fields: { ...deal.fields, ...(input.fields ?? {}) },
  };
  if (next.planId && next.planId !== deal.planId) {
    const plan = getPlan(ctx, next.planId);
    if (plan.status !== "active") throw new ZnError("停止中のプランは選べません");
    if (plan.productId !== product.id) throw new ZnError("別の商材のプランは選べません");
    if (input.amount === undefined) next.amount = priceAt(plan, today(ctx.clock)).incl;
  }
  const missing = missingFields(product, next, stage);
  if (missing.length) throw new ZnError(`「${stage.name}」に進めるには次の項目が必要です：${missing.map((m) => m.label).join("、")}`, "missing_fields", missing);
  for (const k of stage.requiredFields) {
    if (k === "resumeDate" && !isDate(next.fields.resumeDate)) throw new ZnError("再開予定日を正しく入力してください", "missing_fields", [{ key: k, label: fieldLabel(product, k) }]);
  }

  // 次のアクション
  let action: NextAction | null = input.nextAction !== undefined ? input.nextAction : defaultNextAction(ctx, stage, next.fields);
  if (stage.kind === "lost") action = input.nextAction ?? (next.fields.reapproachDate ? { title: "再アプローチ", due: next.fields.reapproachDate } : null);
  if (stage.kind === "registered") action = null;
  if (ACTION_REQUIRED_KINDS.includes(stage.kind) && !action) throw new ZnError("次のアクションと期限を入力してください", "missing_next_action");
  if (action && (!action.title.trim() || !isDate(action.due))) throw new ZnError("次のアクションと期限を正しく入力してください", "missing_next_action");

  next.stageId = stage.id;
  next.nextAction = action;
  if (stage.id !== deal.stageId) {
    next.stageEnteredAt = now;
    next.history = [...(deal.history ?? []), { stageId: stage.id, at: now, by: user.email }];
  }
  next.status = stage.kind === "lost" ? "lost" : stage.kind === "won" || stage.kind === "registered" ? "won" : "open";
  next.closedAt = next.status === "open" ? null : deal.closedAt ?? now;
  next.updatedAt = now;
  next.version = deal.version + 1;
  if (!next.owner) next.owner = pickSalesOwner(ctx, product, user.role === "sales" ? user.email : null);
  ctx.store.put("deals", next);

  const customer = getCustomer(ctx, deal.customerId);
  recordActivity(ctx, user.email, {
    customerId: deal.customerId,
    dealId,
    type: "stage",
    result: `${from.name} → ${stage.name}`,
    note: [input.note, stage.kind === "lost" ? `理由：${next.fields.lostReason ?? ""}` : ""].filter(Boolean).join("\n"),
  });
  audit(ctx, user, "deal.stage", "deals", dealId, { from: from.id, to: stage.id });

  const result: MoveResult = { deal: next };
  switch (stage.kind) {
    case "meeting":
      if (next.fields.meetingAt) {
        recordActivity(ctx, user.email, { customerId: deal.customerId, dealId, type: "meeting", result: "面談の予定", note: `日時：${next.fields.meetingAt}` });
      }
      break;
    case "contract":
      // 契約システムとの連携（12章）は後日。連携前は作成依頼を記録する
      recordActivity(ctx, user.email, { customerId: deal.customerId, dealId, type: "contract", result: "契約の作成依頼", note: `${next.amount?.toLocaleString("ja-JP") ?? ""}円・${next.paymentMethod ?? ""}` });
      break;
    case "won":
      Object.assign(result, recordWon(ctx, user, next, customer, input.signedAt));
      break;
    case "registered":
      if (!ctx.store.all<Delivery>("deliveries").some((d) => d.dealId === dealId && d.status !== "canceled")) {
        if (!ctx.store.all<Contract>("contracts").some((c) => c.dealId === dealId)) Object.assign(result, recordWon(ctx, user, next, customer, input.signedAt));
        result.delivery = createDelivery(ctx, user.email, { customerId: deal.customerId, productId: deal.productId, planId: next.planId!, dealId });
        notifyRegistered(ctx, product, next, customer, result.delivery);
      }
      break;
    case "lost":
      if (customer.status === "lead") ctx.store.put("customers", { ...customer, status: "dormant", updatedAt: now, version: customer.version + 1 });
      break;
    default:
      break;
  }
  return result;
}

/** 成約の処理（ZN-SALES-10）：契約・売上予定・登録フォームの案内 */
function recordWon(ctx: Ctx, user: User, deal: Deal, customer: Customer, signedAt?: string): Omit<MoveResult, "deal"> {
  const existing = ctx.store.all<Contract>("contracts").find((c) => c.dealId === deal.id && c.status === "signed");
  if (existing) return { contract: existing };
  if (!deal.planId || !deal.amount || !deal.paymentMethod) {
    throw new ZnError("成約にはプラン・金額・支払い方法が必要です", "missing_fields", [
      { key: "planId", label: "プラン" },
      { key: "amount", label: "金額" },
      { key: "paymentMethod", label: "支払い方法" },
    ]);
  }
  const product = getProduct(ctx, deal.productId);
  const plan = getPlan(ctx, deal.planId);
  const contract: Contract = {
    id: newId("ct", ctx.clock),
    dealId: deal.id,
    customerId: deal.customerId,
    productId: deal.productId,
    planId: deal.planId,
    amountIncl: deal.amount,
    paymentMethod: deal.paymentMethod,
    signedAt: signedAt && isDate(signedAt) ? signedAt : today(ctx.clock),
    status: "signed",
    externalId: null,
    createdAt: nowIso(ctx.clock),
  };
  ctx.store.put("contracts", contract);
  // 計上の基準日（Q-03）：契約日・入金日は契約時に予定を作る。提供開始日は提供の作成時に作る
  if (product.revenueBasis !== "delivery_start") createRevenueForContract(ctx, contract, deal);
  if (customer.status !== "customer") ctx.store.put("customers", { ...customer, status: "customer", updatedAt: nowIso(ctx.clock), version: customer.version + 1 });
  recordActivity(ctx, user.email, { customerId: deal.customerId, dealId: deal.id, type: "contract", result: "契約の締結", note: `${plan.name}・${deal.amount.toLocaleString("ja-JP")}円・${deal.paymentMethod}` });
  const form = getSettings(ctx).forms.find((f) => f.id === plan.formId && f.active);
  const url = form && ctx.prefillUrl ? ctx.prefillUrl(form.id, { name: customer.name, email: customer.email }) : form?.publishedUrl ?? null;
  const accounting = ctx.store.all<User>("users").filter((u) => u.active && u.role === "accounting").map((u) => u.email);
  ctx.notifier.send({
    kind: "deal.won",
    to: [...new Set([deal.owner, ...accounting].filter((x): x is string => !!x))],
    title: `成約：${customer.name}（${plan.name}）`,
    body: `${deal.amount.toLocaleString("ja-JP")}円・${deal.paymentMethod}${url ? `\n${label("registration", product)}フォーム：${url}` : ""}`,
    productId: product.id,
  });
  audit(ctx, user, "contract.create", "contracts", contract.id, { dealId: deal.id, amount: contract.amountIncl });
  return { contract, registrationUrl: url };
}

export function notifyRegistered(ctx: Ctx, product: Product, deal: Deal | null, customer: Customer, delivery: Delivery) {
  const to = [delivery.owner, deal?.owner].filter((x): x is string => !!x);
  if (!to.length) return;
  ctx.notifier.send({
    kind: "registration",
    to: [...new Set(to)],
    title: `${label("registration", product)}：${customer.name}`,
    body: `${label("delivery", product)}を作成しました（${delivery.startDate}〜${delivery.endDate}）。`,
    productId: product.id,
  });
}

/** 次のアクションを完了にし、次のアクションを入れる（ZN-SALES-05, ZN-DASH-02） */
export function completeNextAction(ctx: Ctx, user: User, dealId: string, next: NextAction | null, note = ""): Deal {
  const deal = getDeal(ctx, dealId);
  requireEditable(ctx, user, deal);
  const product = getProduct(ctx, deal.productId);
  const stage = stageById(product, deal.stageId);
  if (deal.status === "open" && ACTION_REQUIRED_KINDS.includes(stage.kind) && !next) throw new ZnError("進行中の商談には次のアクションが必要です", "missing_next_action");
  if (next && (!next.title.trim() || !isDate(next.due))) throw new ZnError("次のアクションと期限を正しく入力してください");
  if (deal.nextAction) {
    recordActivity(ctx, user.email, { customerId: deal.customerId, dealId, type: "memo", result: `完了：${deal.nextAction.title}`, note });
  }
  const updated: Deal = { ...deal, nextAction: next, updatedAt: nowIso(ctx.clock), version: deal.version + 1 };
  ctx.store.put("deals", updated);
  return updated;
}

/** 延期（明日・来週・日付指定） */
export function postponeNextAction(ctx: Ctx, user: User, ref: { dealId?: string; deliveryId?: string }, due: string): void {
  if (!isDate(due)) throw new ZnError("日付を正しく入力してください");
  if (ref.dealId) {
    const deal = getDeal(ctx, ref.dealId);
    requireEditable(ctx, user, deal);
    if (!deal.nextAction) throw new ZnError("次のアクションがありません");
    ctx.store.put("deals", { ...deal, nextAction: { ...deal.nextAction, due }, updatedAt: nowIso(ctx.clock), version: deal.version + 1 });
    return;
  }
  if (ref.deliveryId) {
    const d = ctx.store.get<Delivery>("deliveries", ref.deliveryId);
    if (!d) throw new ZnError("提供が見つかりません", "not_found");
    if (!can(user, "deliveries.edit") || (user.role === "delivery" && d.owner !== user.email)) throw new ZnError("権限がありません", "forbidden");
    // 提供の次のアクションは、次の予定の進捗項目の予定日を動かす
    const items = ctx.store.all<{ id: string; deliveryId: string; status: string; dueDate: string; seq: number }>("progress").filter((p) => p.deliveryId === d.id && p.status === "planned").sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (items[0]) ctx.store.put("progress", { ...items[0], dueDate: due } as never);
    ctx.store.put("deliveries", { ...d, nextAction: d.nextAction ? { ...d.nextAction, due } : null, updatedAt: nowIso(ctx.clock), version: d.version + 1 });
  }
}

export function updateDeal(ctx: Ctx, user: User, dealId: string, patch: { planId?: string | null; amount?: number | null; paymentMethod?: string | null; owner?: string | null; fields?: Record<string, string>; nextAction?: NextAction | null; source?: string }, expectedVersion?: number): Deal {
  const deal = getDeal(ctx, dealId);
  requireEditable(ctx, user, deal);
  if (expectedVersion !== undefined && expectedVersion !== deal.version) throw new ZnError("他の人が先に更新しました。最新の内容を確認してください", "conflict", deal);
  if (patch.owner !== undefined && patch.owner !== deal.owner && !can(user, "assign.change")) throw new ZnError("担当を変更する権限がありません", "forbidden");
  const product = getProduct(ctx, deal.productId);
  const stage = stageById(product, deal.stageId);
  if (patch.nextAction === null && deal.status === "open" && ACTION_REQUIRED_KINDS.includes(stage.kind)) throw new ZnError("進行中の商談には次のアクションが必要です", "missing_next_action");
  if (patch.planId) {
    const plan = getPlan(ctx, patch.planId);
    if (plan.productId !== deal.productId) throw new ZnError("別の商材のプランは選べません");
  }
  const next: Deal = {
    ...deal,
    ...(patch.planId !== undefined ? { planId: patch.planId } : {}),
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    ...(patch.paymentMethod !== undefined ? { paymentMethod: patch.paymentMethod } : {}),
    ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.nextAction !== undefined ? { nextAction: patch.nextAction } : {}),
    fields: { ...deal.fields, ...(patch.fields ?? {}) },
    updatedAt: nowIso(ctx.clock),
    version: deal.version + 1,
  };
  ctx.store.put("deals", next);
  if (patch.owner !== undefined && patch.owner !== deal.owner) {
    audit(ctx, user, "deal.owner", "deals", dealId, { from: deal.owner, to: patch.owner });
    if (patch.owner) ctx.notifier.send({ kind: "deal.assigned", to: [patch.owner], title: "商談の担当になりました", body: getCustomer(ctx, deal.customerId).name, productId: deal.productId });
  }
  return next;
}

export interface BoardCard {
  deal: Deal;
  customerName: string;
  planName: string;
  daysInStage: number;
  stale: boolean;
  overdue: boolean;
}

/** 営業ボード（ZN-SALES-01/02/06） */
export function salesBoard(ctx: Ctx, user: User, opts: { productId: string; owner?: "me" | "all" | string; includeClosed?: boolean }) {
  const product = getProduct(ctx, opts.productId);
  if (!productAllowed(user, product.id)) throw new ZnError("担当外の商材です", "forbidden");
  const t = today(ctx.clock);
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c]));
  const plans = getSettings(ctx).plans;
  const deals = visibleDeals(ctx, user).filter(
    (d) =>
      d.productId === product.id &&
      (!opts.owner || opts.owner === "all" || (opts.owner === "me" ? d.owner === user.email : d.owner === opts.owner)) &&
      (opts.includeClosed || d.status === "open" || diffDays(dateOfIso(d.updatedAt), t) <= 30),
  );
  const columns = [...product.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      stage,
      cards: deals
        .filter((d) => d.stageId === stage.id)
        .map<BoardCard>((d) => {
          const days = diffDays(dateOfIso(d.stageEnteredAt), t);
          return {
            deal: d,
            customerName: customers.get(d.customerId)?.name ?? "",
            planName: plans.find((p) => p.id === d.planId)?.name ?? "",
            daysInStage: days,
            stale: d.status === "open" && !!stage.staleDays && days >= stage.staleDays,
            overdue: !!d.nextAction && d.nextAction.due < t,
          };
        })
        .sort((a, b) => (a.deal.nextAction?.due ?? "9999") < (b.deal.nextAction?.due ?? "9999") ? -1 : 1),
    }));
  return { product, columns };
}

/** ファネル分析（ZN-SALES-14）：段階ごとの件数・次の段階への移行率・平均日数 */
export function funnel(ctx: Ctx, user: User, opts: { productId: string; from?: string; to?: string; groupBy?: "owner" | "source" | null }) {
  const product = getProduct(ctx, opts.productId);
  const stages = [...product.stages].filter((s) => s.kind !== "lost" && s.kind !== "hold").sort((a, b) => a.order - b.order);
  const deals = visibleDeals(ctx, user).filter((d) => d.productId === product.id && (!opts.from || dateOfIso(d.createdAt) >= opts.from) && (!opts.to || dateOfIso(d.createdAt) <= opts.to));
  const calc = (rows: Deal[]) =>
    stages.map((s, i) => {
      const reached = rows.filter((d) => d.history.some((h) => h.stageId === s.id) || stages.findIndex((x) => x.id === d.stageId) >= i);
      const nextStage = stages[i + 1];
      const moved = nextStage ? reached.filter((d) => d.history.some((h) => h.stageId === nextStage.id) || stages.findIndex((x) => x.id === d.stageId) > i) : [];
      const durations = reached
        .map((d) => {
          const enter = d.history.find((h) => h.stageId === s.id)?.at;
          const idx = d.history.findIndex((h) => h.stageId === s.id);
          const leave = idx >= 0 ? d.history[idx + 1]?.at : undefined;
          return enter && leave ? diffDays(dateOfIso(enter), dateOfIso(leave)) : null;
        })
        .filter((x): x is number => x !== null);
      return {
        stageId: s.id,
        name: s.name,
        count: reached.length,
        conversion: nextStage && reached.length ? Math.round((moved.length / reached.length) * 1000) / 10 : null,
        avgDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      };
    });
  const lost = deals.filter((d) => d.status === "lost");
  const groups = opts.groupBy
    ? [...new Set(deals.map((d) => (opts.groupBy === "owner" ? d.owner ?? "（未設定）" : d.source || "（不明）")))].map((k) => ({
        key: k,
        stages: calc(deals.filter((d) => (opts.groupBy === "owner" ? d.owner ?? "（未設定）" : d.source || "（不明）") === k)),
      }))
    : [];
  // 失注の分析（ZN-SALES-15）
  const lostReasons: Record<string, number> = {};
  const lostByStage: Record<string, number> = {};
  for (const d of lost) {
    const r = d.fields.lostReason || "（未入力）";
    lostReasons[r] = (lostReasons[r] ?? 0) + 1;
    const before = d.history[d.history.length - 2]?.stageId;
    const name = product.stages.find((s) => s.id === before)?.name ?? "（不明）";
    lostByStage[name] = (lostByStage[name] ?? 0) + 1;
  }
  return { stages: calc(deals), groups, lost: { total: lost.length, reasons: lostReasons, byStage: lostByStage } };
}

export function listDeals(ctx: Ctx, user: User, f: { productId?: string; stageId?: string; owner?: string; status?: Deal["status"] | ""; q?: string } = {}) {
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c]));
  const s = getSettings(ctx);
  const q = f.q?.trim().toLowerCase();
  const t = today(ctx.clock);
  return visibleDeals(ctx, user)
    .filter((d) => (!f.productId || d.productId === f.productId) && (!f.stageId || d.stageId === f.stageId) && (!f.owner || d.owner === f.owner) && (!f.status || d.status === f.status))
    .map((d) => {
      const product = s.products.find((p) => p.id === d.productId);
      return {
        ...d,
        customerName: customers.get(d.customerId)?.name ?? "",
        productName: product?.name ?? "",
        stageName: product?.stages.find((x) => x.id === d.stageId)?.name ?? "",
        planName: s.plans.find((p) => p.id === d.planId)?.name ?? "",
        daysInStage: diffDays(dateOfIso(d.stageEnteredAt), t),
      };
    })
    .filter((d) => !q || d.customerName.toLowerCase().includes(q))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

