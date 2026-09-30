// API の窓口。Apps Script（doPost）とブラウザのデモモードの両方から同じ関数を呼ぶ。
import { type Ctx } from "./context";
import * as customers from "./customers";
import { dashboard, todoList } from "./dashboard";
import * as deals from "./deals";
import * as deliveries from "./deliveries";
import { can } from "./permissions";
import * as registration from "./registration";
import * as revenues from "./revenues";
import * as settings from "./settings";
import type { AuditEntry, ImportLog, SavedView, Settings, Target, User } from "./types";
import * as users from "./users";
import { newId, ZnError } from "./util";

export type ApiRequest = { action: string; params?: Record<string, unknown> };
export type ApiResponse = { ok: true; data: unknown } | { ok: false; error: string; code: string; details?: unknown };

export type Handler = (ctx: Ctx, user: User, p: Record<string, any>) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

function publicSettings(s: Settings, user: User) {
  const secret = !can(user, "settings.sources");
  return {
    ...s,
    notifications: secret ? { slackWebhook: "", googleChatWebhook: "", email: s.notifications.email } : s.notifications,
    dataSources: secret ? [] : s.dataSources,
    forms: secret ? s.forms.map((f) => ({ ...f, mapping: {}, responseSpreadsheetId: "" })) : s.forms,
  };
}

const handlers: Record<string, Handler> = {
  // セッション
  session: (ctx, user) => ({
    user,
    settings: publicSettings(settings.getSettings(ctx), user),
    users: users.listUsers(ctx).map((u) => ({ email: u.email, name: u.name, role: u.role, productIds: u.productIds, active: u.active })),
    templates: settings.PRODUCT_TEMPLATES.map((t) => ({ templateType: t.templateType, label: t.label, description: t.description })),
  }),

  // ダッシュボード
  dashboard: (ctx, user, p) => dashboard(ctx, user, { period: p.period, productId: p.productId }),
  todo: (ctx, user, p) => todoList(ctx, user, { productId: p.productId, scope: p.scope, horizonDays: p.horizonDays }),

  // 顧客
  "customers.list": (ctx, user, p) => customers.listCustomers(ctx, user, p.filter ?? {}),
  "customers.get": (ctx, user, p) => customers.customerDetail(ctx, user, String(p.id)),
  "customers.create": (ctx, user, p) => customers.createCustomer(ctx, user, p.customer),
  "customers.update": (ctx, user, p) => customers.updateCustomer(ctx, user, String(p.id), p.patch ?? {}, p.version),
  "customers.bulk": (ctx, user, p) => customers.bulkUpdateCustomers(ctx, user, p.ids ?? [], p.patch ?? {}),
  "customers.duplicates": (ctx, user) => customers.duplicateCandidates(ctx, user),
  "customers.merge": (ctx, user, p) => customers.mergeCustomers(ctx, user, String(p.primaryId), String(p.secondaryId), p.pick ?? {}),
  "customers.export": (ctx, user, p) => customers.exportCustomerData(ctx, user, String(p.id)),
  "activities.add": (ctx, user, p) => customers.addActivity(ctx, user, p.activity),

  // 営業
  "deals.createLead": (ctx, user, p) => deals.createLead(ctx, user, p.lead),
  "deals.board": (ctx, user, p) => deals.salesBoard(ctx, user, { productId: String(p.productId), owner: p.owner, includeClosed: p.includeClosed }),
  "deals.list": (ctx, user, p) => deals.listDeals(ctx, user, p.filter ?? {}),
  "deals.move": (ctx, user, p) => deals.moveStage(ctx, user, String(p.id), p.move),
  "deals.update": (ctx, user, p) => deals.updateDeal(ctx, user, String(p.id), p.patch ?? {}, p.version),
  "deals.completeAction": (ctx, user, p) => deals.completeNextAction(ctx, user, String(p.id), p.next ?? null, p.note ?? ""),
  "actions.postpone": (ctx, user, p) => deals.postponeNextAction(ctx, user, { dealId: p.dealId, deliveryId: p.deliveryId }, String(p.due)),
  "deals.funnel": (ctx, user, p) => deals.funnel(ctx, user, { productId: String(p.productId), from: p.from, to: p.to, groupBy: p.groupBy ?? null }),
  "targets.list": (ctx, user, p) => ctx.store.all<Target>("targets").filter((t) => (!p.month || t.month === p.month) && (can(user, "assign.change") || t.user === user.email)),
  "targets.save": (ctx, user, p) => {
    if (!can(user, "assign.change")) throw new ZnError("目標を設定する権限がありません", "forbidden");
    const t: Target = { id: `${p.user}:${p.month}`, user: String(p.user), month: String(p.month), count: Number(p.count) || 0, amount: Number(p.amount) || 0 };
    return ctx.store.put("targets", t);
  },

  // 提供
  "deliveries.matrix": (ctx, user, p) => deliveries.progressMatrix(ctx, user, { productId: String(p.productId), owner: p.owner, status: p.status }),
  "deliveries.get": (ctx, user, p) => deliveries.deliveryDetail(ctx, user, String(p.id)),
  "deliveries.recordSession": (ctx, user, p) => deliveries.recordSession(ctx, user, String(p.itemId), p.record),
  "deliveries.completeItem": (ctx, user, p) => deliveries.completeItem(ctx, user, String(p.itemId), String(p.date)),
  "deliveries.reopenItem": (ctx, user, p) => deliveries.reopenItem(ctx, user, String(p.itemId)),
  "deliveries.pause": (ctx, user, p) => deliveries.pauseDelivery(ctx, user, String(p.id), String(p.from), String(p.to), String(p.reason ?? "")),
  "deliveries.resume": (ctx, user, p) => deliveries.resumeDelivery(ctx, user, String(p.id)),
  "deliveries.extend": (ctx, user, p) => deliveries.extendDelivery(ctx, user, String(p.id), String(p.endDate)),
  "deliveries.finish": (ctx, user, p) => deliveries.finishDelivery(ctx, user, String(p.id), p.finish),
  "deliveries.changeOwner": (ctx, user, p) => deliveries.changeDeliveryOwner(ctx, user, String(p.id), String(p.owner), String(p.note ?? "")),

  // 売上
  "revenues.list": (ctx, user, p) => revenues.listRevenues(ctx, user, p.filter ?? {}),
  "revenues.update": (ctx, user, p) => revenues.updateRevenue(ctx, user, String(p.id), p.patch ?? {}),
  "revenues.payment": (ctx, user, p) => revenues.recordPayment(ctx, user, String(p.id), String(p.paidAt), p.amount),
  "revenues.adjust": (ctx, user, p) => revenues.addAdjustment(ctx, user, String(p.parentId), p.adjustment),
  "revenues.summary": (ctx, user, p) => revenues.revenueSummary(ctx, user, { from: String(p.from), to: String(p.to), groupBy: p.groupBy ?? "plan", productId: p.productId, includePlanned: p.includePlanned }),
  "revenues.performance": (ctx, user, p) => revenues.ownerPerformance(ctx, user, String(p.from), String(p.to)),
  "revenues.csv": (ctx, user, p) => revenues.revenueCsv(ctx, user, String(p.month), p.productId),
  "months.list": (ctx) => revenues.closings(ctx),
  "months.close": (ctx, user, p) => revenues.closeMonth(ctx, user, String(p.month)),
  "months.reopen": (ctx, user, p) => revenues.reopenMonth(ctx, user, String(p.month), String(p.reason ?? "")),

  // 登録フォーム
  "registrations.list": (ctx, user, p) => registration.listRegistrations(ctx, user, p.status),
  "registrations.resolve": (ctx, user, p) => registration.resolveRegistration(ctx, user, String(p.id), p.customerId),
  "registrations.testImport": (ctx, user, p) => registration.testImport(ctx, user, p.payload, p.form),
  "imports.list": (ctx, user) => {
    if (!can(user, "settings.sources")) throw new ZnError("権限がありません", "forbidden");
    return ctx.store.all<ImportLog>("imports").sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200);
  },

  // 設定
  "settings.saveProduct": (ctx, user, p) => settings.saveProduct(ctx, user, p.product),
  "settings.productFromTemplate": (ctx, _user, p) => settings.productFromTemplate(ctx, String(p.templateType), String(p.name), p.dictionary ?? {}),
  "settings.setProductStatus": (ctx, user, p) => settings.setProductStatus(ctx, user, String(p.id), p.status),
  "settings.newPlan": (ctx, _user, p) => settings.newPlan(ctx, String(p.productId), p.plan),
  "settings.savePlan": (ctx, user, p) => settings.savePlan(ctx, user, p.plan),
  "settings.revisePrice": (ctx, user, p) => settings.revisePlanPrice(ctx, user, String(p.planId), String(p.effectiveFrom), Number(p.priceExcl), Number(p.priceIncl)),
  "settings.saveForm": (ctx, user, p) => settings.saveForm(ctx, user, p.form),
  "settings.saveDataSource": (ctx, user, p) => settings.saveDataSource(ctx, user, p.dataSource),
  "settings.update": (ctx, user, p) =>
    settings.updateSettings(
      ctx,
      user,
      (s) => {
        if (p.organizationName !== undefined) s.organizationName = String(p.organizationName);
        if (p.allowedDomains !== undefined) s.allowedDomains = p.allowedDomains;
        if (p.maskedFields !== undefined) s.maskedFields = p.maskedFields;
        if (p.notifications !== undefined) s.notifications = { ...s.notifications, ...p.notifications };
      },
      "基本設定を変更",
      { permission: p.notifications || p.allowedDomains ? "settings.sources" : "settings.products" },
    ),
  "settings.saveWizardDraft": (ctx, user, p) =>
    settings.updateSettings(ctx, user, (s) => {
      s.wizardDrafts = { ...s.wizardDrafts, [String(p.key)]: p.draft };
    }, "設定ウィザードの途中保存"),
  "settings.versions": (ctx) => settings.listVersions(ctx),
  "settings.restore": (ctx, user, p) => settings.restoreVersion(ctx, user, Number(p.version)),
  "settings.export": (ctx, user) => {
    if (!can(user, "settings.products")) throw new ZnError("権限がありません", "forbidden");
    return settings.exportSettings(ctx);
  },
  "settings.import": (ctx, user, p) => settings.importSettings(ctx, user, String(p.json)),

  // 利用者
  "users.list": (ctx, user) => {
    if (!can(user, "users.manage")) throw new ZnError("権限がありません", "forbidden");
    return users.listUsers(ctx);
  },
  "users.save": (ctx, user, p) => users.saveUser(ctx, user, p.user),
  "users.reassign": (ctx, user, p) => users.reassignOwner(ctx, user, p.reassign),

  // 保存ビュー（ZN-CUS-04）
  "views.list": (ctx, user, p) => ctx.store.all<SavedView>("savedViews").filter((v) => v.screen === p.screen && (v.shared || v.owner === user.email)),
  "views.save": (ctx, user, p) => {
    const v: SavedView = { id: p.view.id ?? newId("vw", ctx.clock), name: String(p.view.name), owner: user.email, shared: !!p.view.shared, screen: p.view.screen, filter: JSON.stringify(p.view.filter ?? {}), columns: p.view.columns ?? [] };
    return ctx.store.put("savedViews", v);
  },
  "views.delete": (ctx, user, p) => {
    const v = ctx.store.get<SavedView>("savedViews", String(p.id));
    if (v && (v.owner === user.email || can(user, "users.manage"))) ctx.store.remove("savedViews", v.id);
    return true;
  },

  // 監査ログ
  "audit.list": (ctx, user, p) => {
    if (!can(user, "audit.view")) throw new ZnError("監査ログを見る権限がありません", "forbidden");
    return ctx.store
      .all<AuditEntry>("audit")
      .filter((a) => (!p.entity || a.entity === p.entity) && (!p.user || a.user === p.user))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, Number(p.limit ?? 300));
  },
};

export const API_ACTIONS = Object.keys(handlers);

/** 読み取り専用のアクション（Apps Script でロックを取らずに実行できる） */
export function isReadOnly(action: string): boolean {
  return /\.(list|get|board|matrix|summary|funnel|performance|duplicates|versions|export|csv|inspect)$/.test(action) || action === "session" || action === "dashboard" || action === "todo" || action === "months.list";
}

/** 認証済みのメールアドレスでAPIを実行する */
export function handleApi(ctx: Ctx, email: string, req: ApiRequest, extra: Record<string, Handler> = {}): ApiResponse {
  try {
    const user = users.authenticate(ctx, email);
    const h = extra[req.action] ?? handlers[req.action];
    if (!h) throw new ZnError(`不明な操作です：${req.action}`, "not_found");
    return { ok: true, data: h(ctx, user, req.params ?? {}) ?? null };
  } catch (e) {
    if (e instanceof ZnError) return { ok: false, error: e.message, code: e.code, details: e.details };
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: "server_error" };
  }
}
