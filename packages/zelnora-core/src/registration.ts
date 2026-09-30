import { audit, type Ctx } from "./context";
import { newCustomer, recordActivity } from "./customers";
import { nowIso } from "./dates";
import { notifyRegistered } from "./deals";
import { createDelivery } from "./deliveries";
import { matchCustomer } from "./dedupe";
import { label } from "./dictionary";
import { can } from "./permissions";
import { firstStageOfKind, getPlan, getProduct, getSettings } from "./settings";
import { OverlayStore } from "./store";
import type { Customer, Deal, Delivery, FormMapping, ImportLog, Registration, User } from "./types";
import { newId, normalizeEmail, ZnError } from "./util";

export interface FormResponsePayload {
  formId: string;
  responseId: string;
  submittedAt: string;
  /** 質問ID（item ID）→ 回答 */
  answers: Record<string, string>;
  /** 質問ID → 質問文（表示用の控え） */
  questions?: Record<string, string>;
}

export interface ImportResult {
  status: Registration["status"];
  message: string;
  registration: Registration | null;
  customer: Customer | null;
  delivery: Delivery | null;
  dealId: string | null;
}

/** 回答を、フォームの対応付け（質問ID→項目）で顧客・提供の項目に変換する */
export function mapAnswers(form: FormMapping, answers: Record<string, string>) {
  const customer: Record<string, string> = {};
  const custom: Record<string, string> = {};
  const delivery: Record<string, string> = {};
  const deal: Record<string, string> = {};
  for (const [qid, target] of Object.entries(form.mapping)) {
    const v = answers[qid];
    if (v === undefined || v === "") continue;
    if (target.startsWith("customer.custom.")) custom[target.slice(16)] = v;
    else if (target.startsWith("customer.")) customer[target.slice(9)] = v;
    else if (target.startsWith("delivery.fields.")) delivery[target.slice(16)] = v;
    else if (target.startsWith("deal.fields.")) deal[target.slice(12)] = v;
  }
  return { customer, custom, delivery, deal };
}

function managers(ctx: Ctx, productId: string): string[] {
  return ctx.store
    .all<User>("users")
    .filter((u) => u.active && (u.role === "manager" || u.role === "admin") && (u.role === "admin" || u.productIds.includes(productId)))
    .map((u) => u.email);
}

/**
 * 登録フォームの取り込み（5.2）。
 * 1) 対応付けから商材・プランを特定 2) 同じ人を探す 3) 成約の商談を「登録完了」へ 4) 提供と進捗項目を作る 5) 通知 6) ログ
 */
export function importFormResponse(ctx: Ctx, payload: FormResponsePayload, opts: { forceCustomerId?: string } = {}): ImportResult {
  const settings = getSettings(ctx);
  const form = settings.forms.find((f) => f.id === payload.formId && f.active);
  if (!form) throw new ZnError(`対応付けのないフォームです（${payload.formId}）`, "no_mapping");
  const product = getProduct(ctx, form.productId);
  const plan = getPlan(ctx, form.planId);
  const mapped = mapAnswers(form, payload.answers);
  const now = nowIso(ctx.clock);
  const reg: Registration = {
    id: newId("rg", ctx.clock),
    customerId: null,
    productId: product.id,
    planId: plan.id,
    formId: form.id,
    responseId: payload.responseId,
    answers: payload.answers,
    questions: payload.questions ?? {},
    status: "ok",
    message: "",
    receivedAt: payload.submittedAt || now,
    createdAt: now,
  };
  const managerList = managers(ctx, product.id);

  // 同じ回答の二重取り込みを防ぐ
  const dup = ctx.store.all<Registration>("registrations").find((r) => r.formId === form.id && r.responseId === payload.responseId && r.status === "ok");
  if (dup) return { status: "ok", message: "取り込み済みの回答です", registration: dup, customer: null, delivery: null, dealId: null };

  // 2) 同じ人を探す
  let customer: Customer | null = null;
  if (opts.forceCustomerId) customer = ctx.store.get<Customer>("customers", opts.forceCustomerId);
  else {
    const candidates = matchCustomer(ctx.store.all<Customer>("customers"), { email: mapped.customer.email, phone: mapped.customer.phone }, form.matchBy);
    if (candidates.length > 1) {
      reg.status = "pending_merge";
      reg.message = `同じ人の候補が${candidates.length}件あります（統合の確認待ち）`;
      ctx.store.put("registrations", reg);
      ctx.notifier.send({ kind: "registration.pending", to: managerList, title: `${label("registration", product)}：統合の確認待ち`, body: `${mapped.customer.name ?? ""} ${mapped.customer.email ?? ""}`, productId: product.id });
      return { status: reg.status, message: reg.message, registration: reg, customer: null, delivery: null, dealId: null };
    }
    customer = candidates[0] ?? null;
  }
  if (customer) {
    // 最新の回答で更新（前の回答は登録の履歴に残る）
    const updated: Customer = {
      ...customer,
      name: mapped.customer.name?.trim() || customer.name,
      kana: mapped.customer.kana ?? customer.kana,
      email: mapped.customer.email ? normalizeEmail(mapped.customer.email) : customer.email,
      phone: mapped.customer.phone ?? customer.phone,
      company: mapped.customer.company ?? customer.company,
      custom: { ...customer.custom, ...mapped.custom },
      updatedAt: now,
      version: customer.version + 1,
    };
    ctx.store.put("customers", updated);
    customer = updated;
  } else {
    if (!mapped.customer.name) throw new ZnError("氏名に対応する質問がありません（フォームの対応付けを確認してください）", "mapping");
    customer = newCustomer(ctx, { ...mapped.customer, name: mapped.customer.name, custom: mapped.custom, source: `フォーム：${form.name}`, status: "customer" });
    ctx.store.put("customers", customer);
  }
  reg.customerId = customer.id;

  // 3) 同じ顧客・同じ商材の商談を探す
  const deals = ctx.store.all<Deal>("deals").filter((d) => d.customerId === customer!.id && d.productId === product.id);
  const wonStageIds = product.stages.filter((s) => s.kind === "won").map((s) => s.id);
  const registeredStage = firstStageOfKind(product, "registered");
  const wonDeal = deals.filter((d) => wonStageIds.includes(d.stageId)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const alreadyRegistered = deals.find((d) => d.stageId === registeredStage?.id);
  const existingDelivery = ctx.store.all<Delivery>("deliveries").find((d) => d.customerId === customer!.id && d.productId === product.id && d.planId === plan.id && (d.status === "active" || d.status === "paused"));
  const openDeal = deals.find((d) => d.status === "open");
  let delivery: Delivery | null = null;
  let deal: Deal | null = wonDeal ?? null;

  if (existingDelivery) {
    // 同じ人が2回送信した場合は、最新の回答で更新し、提供は作り直さない
    reg.message = "同じ人の再送信のため、登録内容を更新しました";
    delivery = { ...existingDelivery, fields: { ...existingDelivery.fields, ...mapped.delivery }, updatedAt: now, version: existingDelivery.version + 1 };
    ctx.store.put("deliveries", delivery);
    deal = alreadyRegistered ?? deal;
  } else if (!wonDeal && openDeal) {
    // 契約より先にフォームが届いた場合は保留にして確認を求める（5.4）
    reg.status = "pending_before_contract";
    reg.message = "成約前の商談があるため保留にしました（契約の締結を確認してください）";
    ctx.store.put("registrations", reg);
    recordActivity(ctx, "system", { customerId: customer.id, dealId: openDeal.id, type: "form", result: `${label("registration", product)}（保留）`, note: reg.message });
    ctx.notifier.send({ kind: "registration.pending", to: [...managerList, ...(openDeal.owner ? [openDeal.owner] : [])], title: `${label("registration", product)}：契約前の登録`, body: `${customer.name}：${reg.message}`, productId: product.id });
    return { status: reg.status, message: reg.message, registration: reg, customer, delivery: null, dealId: openDeal.id };
  } else {
    if (wonDeal && form.actions.advanceStage && registeredStage) {
      deal = { ...wonDeal, stageId: registeredStage.id, stageEnteredAt: now, history: [...wonDeal.history, { stageId: registeredStage.id, at: now, by: "system" }], nextAction: null, status: "won", updatedAt: now, version: wonDeal.version + 1 };
      ctx.store.put("deals", deal);
      recordActivity(ctx, "system", { customerId: customer.id, dealId: deal.id, type: "stage", result: `→ ${registeredStage.name}（フォーム）` });
    }
    if (!wonDeal) {
      reg.status = "pending_no_deal";
      reg.message = "商談のない登録です（営業のマネージャーに確認を依頼しました）";
      ctx.notifier.send({ kind: "registration.no_deal", to: managerList, title: `${label("registration", product)}：商談なし`, body: `${customer.name}（${customer.email}）`, productId: product.id });
    }
    if (form.actions.createDelivery) {
      delivery = createDelivery(ctx, "system", { customerId: customer.id, productId: product.id, planId: plan.id, dealId: deal?.id ?? null, fields: mapped.delivery });
      if (form.actions.notify) notifyRegistered(ctx, product, deal, customer, delivery);
    }
    if (!reg.message) reg.message = `${label("delivery", product)}を作成しました`;
  }
  ctx.store.put("registrations", reg);
  recordActivity(ctx, "system", { customerId: customer.id, dealId: deal?.id ?? null, deliveryId: delivery?.id ?? null, type: "registration", result: label("registration", product), note: reg.message });
  return { status: reg.status, message: reg.message, registration: reg, customer, delivery, dealId: deal?.id ?? null };
}

/** 取り込みを実行し、結果を取り込みログに残す。失敗は再試行の対象にする */
export function importWithLog(ctx: Ctx, payload: FormResponsePayload, attempts = 1): ImportResult | null {
  const logId = `${payload.formId}:${payload.responseId}`;
  try {
    const r = importFormResponse(ctx, payload);
    ctx.store.put<ImportLog>("imports", { id: logId, at: nowIso(ctx.clock), formId: payload.formId, responseId: payload.responseId, result: r.status === "ok" || r.status === "pending_no_deal" ? "ok" : "pending", message: r.message, attempts, payload: "" });
    return r;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.store.put<ImportLog>("imports", { id: logId, at: nowIso(ctx.clock), formId: payload.formId, responseId: payload.responseId, result: "failed", message, attempts, payload: JSON.stringify(payload) });
    return null;
  }
}

/** 失敗した回答の再試行（15分ごと） */
export function retryFailedImports(ctx: Ctx, maxAttempts = 5): { retried: number; succeeded: number } {
  let retried = 0;
  let succeeded = 0;
  for (const log of ctx.store.all<ImportLog>("imports")) {
    if (log.result !== "failed" || log.attempts >= maxAttempts || !log.payload) continue;
    retried++;
    if (importWithLog(ctx, JSON.parse(log.payload) as FormResponsePayload, log.attempts + 1)) succeeded++;
  }
  return { retried, succeeded };
}

/** テスト取り込み（ZN-SET-09）：実データを変えずに結果と変更内容を確かめる */
export function testImport(ctx: Ctx, user: User, payload: FormResponsePayload, formOverride?: FormMapping) {
  if (!can(user, "settings.sources")) throw new ZnError("フォームの設定の権限がありません", "forbidden");
  const overlay = new OverlayStore(ctx.store);
  if (formOverride) {
    const s = getSettings(ctx);
    overlay.putSettings({ ...s, forms: [...s.forms.filter((f) => f.id !== formOverride.id), formOverride] });
  }
  const sandbox: Ctx = { ...ctx, store: overlay, notifier: { send: () => {} } };
  try {
    const r = importFormResponse(sandbox, payload);
    return { ok: true, result: r, changes: overlay.changes().map((c) => ({ entity: c.entity, id: c.id })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), changes: [] };
  }
}

/** 保留中の登録を解決する（統合先の顧客を指定して取り込み直す） */
export function resolveRegistration(ctx: Ctx, user: User, registrationId: string, customerId?: string): ImportResult {
  if (!can(user, "assign.change")) throw new ZnError("権限がありません", "forbidden");
  const reg = ctx.store.get<Registration>("registrations", registrationId);
  if (!reg) throw new ZnError("登録が見つかりません", "not_found");
  if (reg.status === "ok") throw new ZnError("この登録は処理済みです", "conflict");
  ctx.store.remove("registrations", reg.id);
  const r = importFormResponse(ctx, { formId: reg.formId, responseId: reg.responseId, submittedAt: reg.receivedAt, answers: reg.answers, questions: reg.questions }, { forceCustomerId: customerId ?? reg.customerId ?? undefined });
  audit(ctx, user, "registration.resolve", "registrations", registrationId, { customerId: customerId ?? null, status: r.status });
  return r;
}

export function listRegistrations(ctx: Ctx, user: User, status?: Registration["status"] | "pending") {
  if (!can(user, "assign.change") && !can(user, "settings.products")) throw new ZnError("権限がありません", "forbidden");
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c]));
  return ctx.store
    .all<Registration>("registrations")
    .filter((r) => !status || (status === "pending" ? r.status !== "ok" : r.status === status))
    .map((r) => ({ ...r, customerName: r.customerId ? customers.get(r.customerId)?.name ?? "" : "" }))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}
