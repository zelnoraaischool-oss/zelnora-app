import consulting from "../templates/consulting.json";
import oneoff from "../templates/oneoff.json";
import school from "../templates/school.json";
import subscription from "../templates/subscription.json";
import { audit, type Ctx } from "./context";
import { nowIso } from "./dates";
import { can } from "./permissions";
import { clone } from "./store";
import type { FormMapping, Plan, Product, Settings, SettingsVersion, Stage, StageKind, User, DataSource } from "./types";
import { newId, ZnError } from "./util";

export interface ProductTemplate {
  templateType: string;
  label: string;
  description: string;
  dictionary: Record<string, string>;
  stages: Stage[];
  progressTemplates: Product["progressTemplates"];
  customFields: Product["customFields"];
  revenueRule: Product["revenueRule"];
  revenueBasis: Product["revenueBasis"];
  deliveryStartBasis: Product["deliveryStartBasis"];
  salesAssignment: Product["salesAssignment"];
  deliveryAssignment: Product["deliveryAssignment"];
  lostReasons: string[];
  activityTemplates: Product["activityTemplates"];
}

/** 商材テンプレート（2.5）。中身はデータ（templates/*.json）として持つ */
export const PRODUCT_TEMPLATES: ProductTemplate[] = [school, consulting, subscription, oneoff] as ProductTemplate[];

export function defaultSettings(clock: Ctx["clock"]): Settings {
  return {
    version: 0,
    organizationName: "",
    products: [],
    plans: [],
    forms: [],
    dataSources: [],
    allowedDomains: [],
    notifications: { slackWebhook: "", googleChatWebhook: "", email: true },
    maskedFields: [
      { field: "email", roles: ["viewer"] },
      { field: "phone", roles: ["viewer"] },
    ],
    wizardDrafts: {},
    updatedAt: nowIso(clock),
    updatedBy: "system",
  };
}

export function getSettings(ctx: Ctx): Settings {
  return ctx.store.getSettings() ?? defaultSettings(ctx.clock);
}

export function getProduct(ctx: Ctx, id: string): Product {
  const p = getSettings(ctx).products.find((x) => x.id === id);
  if (!p) throw new ZnError("商材が見つかりません", "not_found");
  return p;
}

export function getPlan(ctx: Ctx, id: string): Plan {
  const p = getSettings(ctx).plans.find((x) => x.id === id);
  if (!p) throw new ZnError("プランが見つかりません", "not_found");
  return p;
}

export function stageById(product: Product, stageId: string): Stage {
  const s = product.stages.find((x) => x.id === stageId);
  if (!s) throw new ZnError("段階が見つかりません", "not_found");
  return s;
}

export function firstStageOfKind(product: Product, kind: StageKind): Stage | null {
  return [...product.stages].sort((a, b) => a.order - b.order).find((s) => s.kind === kind) ?? null;
}

/** 設定の検証。問題の一覧を返す */
export function validateSettings(s: Settings): string[] {
  const problems: string[] = [];
  for (const p of s.products) {
    if (!p.name.trim()) problems.push("商材名が空です");
    const kinds = new Set(p.stages.map((x) => x.kind));
    for (const k of ["new", "won", "lost"] as StageKind[]) {
      if (!kinds.has(k)) problems.push(`「${p.name}」に種類「${k}」の段階がありません`);
    }
    const ids = new Set<string>();
    for (const st of p.stages) {
      if (ids.has(st.id)) problems.push(`「${p.name}」の段階IDが重複しています：${st.id}`);
      ids.add(st.id);
      if (!st.name.trim()) problems.push(`「${p.name}」に名前のない段階があります`);
    }
    if (!p.progressTemplates.length) problems.push(`「${p.name}」に進捗テンプレートがありません`);
  }
  for (const pl of s.plans) {
    if (!s.products.some((p) => p.id === pl.productId)) problems.push(`プラン「${pl.name}」の商材がありません`);
    if (pl.priceIncl < 0 || pl.priceExcl < 0) problems.push(`プラン「${pl.name}」の金額が不正です`);
    if (pl.duration.value <= 0) problems.push(`プラン「${pl.name}」の期間が不正です`);
  }
  for (const f of s.forms) {
    if (f.purpose === "lead") {
      if (!s.products.some((p) => p.id === f.productId)) problems.push(`フォーム「${f.name}」の商材がありません`);
    } else if (!s.plans.some((p) => p.id === f.planId)) problems.push(`フォーム「${f.name}」のプランがありません`);
  }
  return problems;
}

/**
 * 設定を変更する。変更ごとに版を残し、任意の版に戻せるようにする（ZN-SET-12）。
 */
export function updateSettings(ctx: Ctx, actor: User, mutate: (s: Settings) => void, comment: string, opts: { permission?: "settings.products" | "settings.sources" } = {}): Settings {
  if (!can(actor, opts.permission ?? "settings.products")) throw new ZnError("設定を変更する権限がありません", "forbidden");
  const current = getSettings(ctx);
  const next = clone(current);
  mutate(next);
  const problems = validateSettings(next);
  if (problems.length) throw new ZnError(problems.join("\n"), "invalid_settings", problems);
  next.version = current.version + 1;
  next.updatedAt = nowIso(ctx.clock);
  next.updatedBy = actor.email;
  ctx.store.putSettings(next);
  const v: SettingsVersion = {
    id: `v${String(next.version).padStart(6, "0")}`,
    version: next.version,
    at: next.updatedAt,
    by: actor.email,
    comment,
    snapshot: JSON.stringify(next),
  };
  ctx.store.put("settingsVersions", v);
  audit(ctx, actor, "settings.update", "settings", String(next.version), { comment });
  return next;
}

export function listVersions(ctx: Ctx): Omit<SettingsVersion, "snapshot">[] {
  return ctx.store
    .all<SettingsVersion>("settingsVersions")
    .sort((a, b) => b.version - a.version)
    .map(({ snapshot: _s, ...rest }) => rest);
}

export function restoreVersion(ctx: Ctx, actor: User, version: number): Settings {
  const v = ctx.store.all<SettingsVersion>("settingsVersions").find((x) => x.version === version);
  if (!v) throw new ZnError("指定の版が見つかりません", "not_found");
  const snap = JSON.parse(v.snapshot) as Settings;
  return updateSettings(
    ctx,
    actor,
    (s) => {
      Object.assign(s, snap);
    },
    `第${version}版に戻す`,
  );
}

/** 設定一式をJSONで書き出す（ZN-SET-13） */
export function exportSettings(ctx: Ctx): string {
  const s = getSettings(ctx);
  // Webhook等の秘密値は書き出さない
  return JSON.stringify({ ...s, notifications: { ...s.notifications, slackWebhook: "", googleChatWebhook: "" } }, null, 2);
}

export function importSettings(ctx: Ctx, actor: User, json: string): Settings {
  let data: Settings;
  try {
    data = JSON.parse(json) as Settings;
  } catch {
    throw new ZnError("JSONの形式が正しくありません");
  }
  if (!Array.isArray(data.products) || !Array.isArray(data.plans)) throw new ZnError("設定のJSONではありません");
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const keepSecrets = s.notifications;
      Object.assign(s, data);
      s.notifications = { ...data.notifications, slackWebhook: keepSecrets.slackWebhook, googleChatWebhook: keepSecrets.googleChatWebhook };
    },
    "設定の読み込み",
    { permission: "settings.sources" },
  );
}

/** テンプレートから商材を作る（設定ウィザードの手順1〜2） */
export function productFromTemplate(ctx: Ctx, templateType: string, name: string, dictionary: Record<string, string> = {}): Product {
  const t = PRODUCT_TEMPLATES.find((x) => x.templateType === templateType);
  if (!t) throw new ZnError("商材テンプレートが見つかりません", "not_found");
  const now = nowIso(ctx.clock);
  return {
    id: newId("pr", ctx.clock),
    name: name.trim(),
    templateType,
    status: "active",
    dictionary: { ...t.dictionary, ...dictionary },
    stages: clone(t.stages),
    progressTemplates: clone(t.progressTemplates),
    customFields: clone(t.customFields),
    revenueRule: t.revenueRule,
    revenueBasis: t.revenueBasis,
    deliveryStartBasis: t.deliveryStartBasis,
    defaultSalesOwner: null,
    defaultDeliveryOwner: null,
    salesAssignment: t.salesAssignment,
    deliveryAssignment: t.deliveryAssignment,
    activityTemplates: clone(t.activityTemplates),
    lostReasons: [...t.lostReasons],
    createdAt: now,
    updatedAt: now,
  };
}

export function newPlan(ctx: Ctx, productId: string, input: Partial<Plan> & { name: string }): Plan {
  const now = nowIso(ctx.clock);
  return {
    id: input.id ?? newId("pl", ctx.clock),
    productId,
    name: input.name,
    description: input.description ?? "",
    priceBasis: input.priceBasis ?? "incl",
    priceExcl: input.priceExcl ?? 0,
    priceIncl: input.priceIncl ?? 0,
    taxRate: input.taxRate ?? 0.1,
    rounding: input.rounding ?? "floor",
    duration: input.duration ?? { value: 3, unit: "month" },
    payment: input.payment ?? { type: "lump", count: 1, intervalMonths: 1 },
    revenueRule: input.revenueRule ?? null,
    progressTemplateId: input.progressTemplateId ?? null,
    formId: input.formId ?? null,
    status: input.status ?? "active",
    priceHistory: input.priceHistory ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function saveProduct(ctx: Ctx, actor: User, product: Product): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const i = s.products.findIndex((p) => p.id === product.id);
      const next = { ...product, updatedAt: nowIso(ctx.clock) };
      if (i >= 0) s.products[i] = next;
      else s.products.push(next);
    },
    `商材「${product.name}」を保存`,
  );
}

export function setProductStatus(ctx: Ctx, actor: User, productId: string, status: Product["status"]): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const p = s.products.find((x) => x.id === productId);
      if (!p) throw new ZnError("商材が見つかりません", "not_found");
      p.status = status;
    },
    status === "stopped" ? "商材を停止" : "商材を再開",
  );
}

export function savePlan(ctx: Ctx, actor: User, plan: Plan): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const i = s.plans.findIndex((p) => p.id === plan.id);
      const next = { ...plan, updatedAt: nowIso(ctx.clock) };
      if (i >= 0) {
        const prev = s.plans[i]!;
        // 価格が変わった場合は、改定日付きの履歴として残す（改定日を指定しないと今日から）
        if (prev.priceIncl !== plan.priceIncl || prev.priceExcl !== plan.priceExcl) {
          const hasRevision = plan.priceHistory.some((h) => h.priceIncl === plan.priceIncl && h.priceExcl === plan.priceExcl);
          if (!hasRevision) throw new ZnError("価格を変えるときは「価格の改定」から改定日を指定してください");
        }
        s.plans[i] = next;
      } else s.plans.push(next);
    },
    `プラン「${plan.name}」を保存`,
  );
}

/** 価格改定（ZN-REV-08）：改定日以降の契約だけが新しい価格になる */
export function revisePlanPrice(ctx: Ctx, actor: User, planId: string, effectiveFrom: string, priceExcl: number, priceIncl: number): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const p = s.plans.find((x) => x.id === planId);
      if (!p) throw new ZnError("プランが見つかりません", "not_found");
      if (!p.priceHistory.length) p.priceHistory.push({ effectiveFrom: "1970-01-01", priceExcl: p.priceExcl, priceIncl: p.priceIncl });
      p.priceHistory = p.priceHistory.filter((h) => h.effectiveFrom !== effectiveFrom);
      p.priceHistory.push({ effectiveFrom, priceExcl, priceIncl });
      p.priceHistory.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
      const today = nowIso(ctx.clock).slice(0, 10);
      const current = [...p.priceHistory].reverse().find((h) => h.effectiveFrom <= today);
      if (current) {
        p.priceExcl = current.priceExcl;
        p.priceIncl = current.priceIncl;
      }
    },
    `プランの価格を改定（${effectiveFrom}〜）`,
  );
}

export function saveForm(ctx: Ctx, actor: User, form: FormMapping): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const i = s.forms.findIndex((f) => f.id === form.id);
      if (i >= 0) s.forms[i] = form;
      else s.forms.push(form);
      const plan = form.purpose === "lead" ? undefined : s.plans.find((p) => p.id === form.planId);
      if (plan) plan.formId = form.id;
    },
    `フォーム「${form.name}」の対応付けを保存`,
    { permission: "settings.sources" },
  );
}

export function saveDataSource(ctx: Ctx, actor: User, ds: DataSource): Settings {
  return updateSettings(
    ctx,
    actor,
    (s) => {
      const i = s.dataSources.findIndex((d) => d.id === ds.id);
      if (i >= 0) s.dataSources[i] = ds;
      else s.dataSources.push(ds);
    },
    `データソース「${ds.name}」を保存`,
    { permission: "settings.sources" },
  );
}
