// 電子契約システムとの連携（12章）。
// - 契約の段階で、プランに対応付けたテンプレートから契約書を作成し、署名URLを顧客に送る
// - 署名が完了したら（通知または定期確認）、商談を成約にして契約の記録に電子契約の契約IDを残す
import { audit, type Ctx, type EsignRemoteStatus, type EsignTemplateInfo } from "./context";
import { getCustomer, recordActivity } from "./customers";
import { dateOfIso, nowIso, today } from "./dates";
import { getDeal, moveStage, requireEditable } from "./deals";
import { can } from "./permissions";
import { firstStageOfKind, getPlan, getProduct, getSettings, updateSettings } from "./settings";
import type { Deal, DealEsign, EsignSettings, EsignStatus, Product, User } from "./types";
import { ZnError } from "./util";

export function defaultEsignSettings(): EsignSettings {
  return { enabled: false, baseUrl: "", sendEmail: true, expiresInDays: 14, autoRequest: true, autoWon: true, plans: {} };
}

export function getEsignSettings(ctx: Ctx): EsignSettings {
  return { ...defaultEsignSettings(), ...(getSettings(ctx).esign ?? {}) };
}

/** テンプレートの変数に入れる値の出どころ */
export function esignValueSources(product: Product | null): { key: string; label: string }[] {
  const list = [
    { key: "customer.name", label: "顧客：氏名" },
    { key: "customer.kana", label: "顧客：ふりがな" },
    { key: "customer.email", label: "顧客：メールアドレス" },
    { key: "customer.phone", label: "顧客：電話番号" },
    { key: "customer.company", label: "顧客：会社名" },
    { key: "product.name", label: "商材名" },
    { key: "plan.name", label: "プラン名" },
    { key: "plan.description", label: "プランの説明" },
    { key: "deal.amount", label: "金額（税込）" },
    { key: "deal.paymentMethod", label: "支払い方法" },
    { key: "deal.owner", label: "担当者のメールアドレス" },
    { key: "today", label: "作成日（今日の日付）" },
  ];
  for (const f of product?.customFields.customer ?? []) list.push({ key: `customer.custom.${f.key}`, label: `顧客：${f.label}` });
  for (const f of product?.customFields.deal ?? []) list.push({ key: `deal.field.${f.key}`, label: `商談：${f.label}` });
  return list;
}

/** 変数名から値の出どころを推測する（設定画面の初期値） */
export function guessEsignSource(variable: { key: string; type: string }): string {
  const k = variable.key;
  if (variable.type === "email" || /メール/.test(k)) return "customer.email";
  if (variable.type === "phone" || /電話/.test(k)) return "customer.phone";
  if (/ふりがな|フリガナ|カナ/.test(k)) return "customer.kana";
  if (/会社|法人|社名/.test(k)) return "customer.company";
  if (/氏名|名前|お名前/.test(k)) return "customer.name";
  if (variable.type === "money" || /金額|料金|代金|報酬|価格|対価/.test(k)) return "deal.amount";
  if (/プラン|コース/.test(k)) return "plan.name";
  if (/支払/.test(k)) return "deal.paymentMethod";
  if (variable.type === "date") return "today";
  return "";
}

/** 値の出どころから実際の値を作る。text: で始まるものは固定の文字 */
export function resolveEsignValue(ctx: Ctx, source: string, deal: Deal): string {
  if (!source) return "";
  if (source.startsWith("text:")) return source.slice(5);
  const customer = getCustomer(ctx, deal.customerId);
  const plan = deal.planId ? getPlan(ctx, deal.planId) : null;
  if (source.startsWith("customer.custom.")) return customer.custom[source.slice(16)] ?? "";
  if (source.startsWith("deal.field.")) return deal.fields[source.slice(11)] ?? "";
  switch (source) {
    case "customer.name":
      return customer.name;
    case "customer.kana":
      return customer.kana;
    case "customer.email":
      return customer.email;
    case "customer.phone":
      return customer.phone;
    case "customer.company":
      return customer.company;
    case "product.name":
      return getProduct(ctx, deal.productId).name;
    case "plan.name":
      return plan?.name ?? "";
    case "plan.description":
      return plan?.description ?? "";
    case "deal.amount":
      return deal.amount === null || deal.amount === undefined ? "" : String(deal.amount);
    case "deal.paymentMethod":
      return deal.paymentMethod ?? "";
    case "deal.owner":
      return deal.owner ?? "";
    case "today":
      return today(ctx.clock);
    default:
      return "";
  }
}

function requireGateway(ctx: Ctx) {
  if (!ctx.esign) throw new ZnError("電子契約システムが設定されていません（Apps Script のスクリプトプロパティ ESIGN_API_KEY を確認してください）", "esign_not_configured");
  return ctx.esign;
}

function callGateway<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZnError) throw e;
    throw new ZnError(`電子契約システムでエラーが発生しました：${e instanceof Error ? e.message : String(e)}`, "esign_error");
  }
}

export function listEsignTemplates(ctx: Ctx, user: User): EsignTemplateInfo[] {
  if (!can(user, "settings.products")) throw new ZnError("権限がありません", "forbidden");
  const g = requireGateway(ctx);
  return callGateway(() => g.templates());
}

export function saveEsignSettings(ctx: Ctx, user: User, input: Partial<EsignSettings>): EsignSettings {
  const current = getEsignSettings(ctx);
  const next: EsignSettings = { ...current, ...input, plans: input.plans ?? current.plans };
  next.baseUrl = next.baseUrl.trim().replace(/\/+$/, "");
  if (next.enabled && !/^https:\/\/[^\s/]+/.test(next.baseUrl) && !/^http:\/\/localhost(:\d+)?/.test(next.baseUrl)) {
    throw new ZnError("電子契約システムのURLは https:// から入力してください", "invalid_settings");
  }
  if (!Number.isInteger(next.expiresInDays) || next.expiresInDays < 1 || next.expiresInDays > 365) {
    throw new ZnError("有効期限は1〜365日で入力してください", "invalid_settings");
  }
  for (const [planId, m] of Object.entries(next.plans)) {
    if (!m.templateId) delete next.plans[planId];
  }
  updateSettings(ctx, user, (s) => {
    s.esign = next;
  }, "電子契約の連携の設定", { permission: "settings.sources" });
  return next;
}

/** 商談で電子契約を作成できるか（できない理由） */
export function esignBlocker(ctx: Ctx, deal: Deal): string | null {
  const s = getEsignSettings(ctx);
  if (!s.enabled) return "電子契約の連携が無効です";
  if (!ctx.esign) return "電子契約システムが設定されていません";
  if (deal.status !== "open") return "進行中の商談ではありません";
  if (!deal.planId) return "プランを選んでください";
  if (!s.plans[deal.planId]?.templateId) return "このプランに使う契約書のテンプレートが設定されていません";
  return null;
}

/** 電子契約の契約書を作成して送る（同じ商談で署名待ちのものがあれば、それを返す） */
export function requestEsign(ctx: Ctx, user: User, dealId: string, opts: { sendEmail?: boolean } = {}): { deal: Deal; url: string | null; emailSent: boolean; created: boolean } {
  const deal = getDeal(ctx, dealId);
  requireEditable(ctx, user, deal);
  const blocker = esignBlocker(ctx, deal);
  if (blocker) throw new ZnError(blocker, "esign_unavailable");
  const s = getEsignSettings(ctx);
  const mapping = s.plans[deal.planId!]!;
  const customer = getCustomer(ctx, deal.customerId);
  const sendEmail = opts.sendEmail ?? s.sendEmail;
  if (sendEmail && !customer.email) throw new ZnError("メールで送るには顧客のメールアドレスが必要です", "missing_fields", [{ key: "email", label: "メールアドレス" }]);
  const values: Record<string, string> = {};
  for (const [variable, source] of Object.entries(mapping.values ?? {})) {
    const v = resolveEsignValue(ctx, source, deal);
    if (v !== "") values[variable] = v;
  }
  const plan = getPlan(ctx, deal.planId!);
  const g = requireGateway(ctx);
  const r = callGateway(() =>
    g.create({
      templateId: mapping.templateId,
      externalRef: deal.id,
      signer: { name: customer.name, email: customer.email || null, phone: customer.phone || null, company: customer.company || null },
      values,
      title: `${mapping.templateName ?? "契約書"}（${customer.name} 様・${plan.name}）`,
      sendEmail,
      expiresInDays: s.expiresInDays,
    }),
  );
  const now = nowIso(ctx.clock);
  const esign: DealEsign = {
    contractId: r.contractId,
    templateId: mapping.templateId,
    status: toStatus(r.status) ?? "sent",
    url: r.url ?? null,
    adminUrl: r.adminUrl ?? null,
    requestedAt: deal.esign?.contractId === r.contractId ? deal.esign.requestedAt : now,
    requestedBy: deal.esign?.contractId === r.contractId ? deal.esign.requestedBy : user.email,
    signedAt: r.signedAt ?? null,
    sha256: r.sha256 ?? null,
    updatedAt: now,
  };
  const next: Deal = { ...deal, esign, updatedAt: now, version: deal.version + 1 };
  ctx.store.put("deals", next);
  const created = r.created !== false;
  if (created) {
    recordActivity(ctx, user.email, {
      customerId: deal.customerId,
      dealId: deal.id,
      type: "contract",
      result: "電子契約の送付",
      note: `${plan.name}・${deal.amount?.toLocaleString("ja-JP") ?? ""}円${r.emailSent ? "・メールで送信" : "・署名URLを発行"}`,
    });
    audit(ctx, user, "esign.request", "deals", deal.id, { contractId: r.contractId, templateId: mapping.templateId });
  }
  return { deal: next, url: r.url ?? null, emailSent: !!r.emailSent, created };
}

/** 契約の段階に移したときの自動作成。失敗しても段階の移動は止めない */
export function autoRequestEsign(ctx: Ctx, user: User, deal: Deal): { requested: boolean; deal?: Deal; url?: string | null; error?: string } {
  const s = getEsignSettings(ctx);
  if (!s.enabled || !s.autoRequest || !ctx.esign || !deal.planId || !s.plans[deal.planId]?.templateId) return { requested: false };
  if (deal.esign && (deal.esign.status === "sent" || deal.esign.status === "viewed" || deal.esign.status === "signed")) return { requested: true, deal, url: deal.esign.url };
  try {
    const r = requestEsign(ctx, user, deal.id);
    return { requested: true, deal: r.deal, url: r.url };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordActivity(ctx, user.email, { customerId: deal.customerId, dealId: deal.id, type: "contract", result: "電子契約の作成に失敗", note: message });
    ctx.notifier.send({
      kind: "esign.failed",
      to: [deal.owner ?? user.email],
      title: `電子契約を作成できませんでした：${getCustomer(ctx, deal.customerId).name}`,
      body: `${message}\n商談の画面から「電子契約を送る」でやり直してください。`,
      productId: deal.productId,
    });
    return { requested: true, deal, error: message };
  }
}

function toStatus(s: string): EsignStatus | null {
  return s === "sent" || s === "viewed" || s === "signed" || s === "canceled" || s === "expired" ? s : null;
}

/** 連携による自動処理の実行者（履歴に「電子契約」と残す） */
const ESIGN_ACTOR: User = { id: "system:esign", email: "電子契約", name: "電子契約", role: "owner", productIds: [], active: true, createdAt: "" };

const STATUS_LABELS: Record<EsignStatus, string> = { sent: "送付済み", viewed: "閲覧済み", signed: "署名完了", canceled: "取消", expired: "期限切れ" };

/**
 * 電子契約システムからの状態（通知・定期確認）を商談に反映する。
 * 同じ状態を何度受け取っても結果は同じ。
 */
export function applyEsignStatus(ctx: Ctx, remote: EsignRemoteStatus): { dealId: string | null; changed: boolean; won: boolean; error?: string } {
  const status = toStatus(remote.status);
  if (!status) return { dealId: null, changed: false, won: false };
  const deals = ctx.store.all<Deal>("deals");
  const deal =
    deals.find((d) => d.esign?.contractId === remote.contractId) ??
    (remote.externalRef ? deals.find((d) => d.id === remote.externalRef) : undefined);
  if (!deal) return { dealId: null, changed: false, won: false };
  // 別の契約書を作り直している場合、古い契約書の取消・期限切れは反映しない
  if (deal.esign && deal.esign.contractId !== remote.contractId && status !== "signed") return { dealId: deal.id, changed: false, won: false };
  const now = nowIso(ctx.clock);
  const prev = deal.esign;
  const changed = !prev || prev.contractId !== remote.contractId || prev.status !== status;
  let current: Deal = deal;
  if (changed) {
    const esign: DealEsign = {
      contractId: remote.contractId,
      templateId: prev?.contractId === remote.contractId ? prev.templateId : prev?.templateId ?? "",
      status,
      url: status === "sent" || status === "viewed" ? remote.url ?? prev?.url ?? null : null,
      adminUrl: remote.adminUrl ?? prev?.adminUrl ?? null,
      requestedAt: prev?.requestedAt ?? now,
      requestedBy: prev?.requestedBy ?? ESIGN_ACTOR.email,
      signedAt: remote.signedAt ?? null,
      sha256: remote.sha256 ?? null,
      updatedAt: now,
    };
    current = { ...deal, esign, updatedAt: now, version: deal.version + 1 };
    ctx.store.put("deals", current);
    if (status !== "viewed") {
      recordActivity(ctx, ESIGN_ACTOR.email, {
        customerId: deal.customerId,
        dealId: deal.id,
        type: "contract",
        result: `電子契約：${STATUS_LABELS[status]}`,
        note: status === "signed" && remote.sha256 ? `確定版PDFのSHA-256：${remote.sha256}` : "",
      });
    }
    audit(ctx, ESIGN_ACTOR, "esign.status", "deals", deal.id, { contractId: remote.contractId, status });
    if (status === "canceled" || status === "expired") {
      ctx.notifier.send({
        kind: "esign.ended",
        to: [deal.owner].filter((x): x is string => !!x),
        title: `電子契約が${STATUS_LABELS[status]}になりました：${getCustomer(ctx, deal.customerId).name}`,
        body: "必要なら商談の画面から作り直してください。",
        productId: deal.productId,
      });
    }
  }
  if (status !== "signed" || current.status !== "open") return { dealId: deal.id, changed, won: false };
  if (!getEsignSettings(ctx).autoWon) return { dealId: deal.id, changed, won: false };
  // 署名完了 → 成約へ
  const product = getProduct(ctx, deal.productId);
  const won = firstStageOfKind(product, "won");
  if (!won) return { dealId: deal.id, changed, won: false };
  try {
    moveStage(ctx, ESIGN_ACTOR, deal.id, {
      stageId: won.id,
      signedAt: remote.signedAt ? dateOfIso(remote.signedAt) : today(ctx.clock),
      externalContractId: remote.contractId,
      note: "電子契約の署名完了により自動で移動",
    });
    return { dealId: deal.id, changed: true, won: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordActivity(ctx, ESIGN_ACTOR.email, { customerId: deal.customerId, dealId: deal.id, type: "contract", result: "成約への自動移動に失敗", note: message });
    ctx.notifier.send({
      kind: "esign.won_failed",
      to: [deal.owner].filter((x): x is string => !!x),
      title: `署名は完了しましたが、成約に移せませんでした：${getCustomer(ctx, deal.customerId).name}`,
      body: `${message}\n商談の画面で項目を入力して、成約に移してください。`,
      productId: deal.productId,
    });
    return { dealId: deal.id, changed: true, won: false, error: message };
  }
}

/** 署名待ちの商談の状態を確認する（通知が届かなかった場合の保険。15分ごと） */
export function syncEsignStatuses(ctx: Ctx, limit = 30): { checked: number; changed: number; errors: number } {
  if (!ctx.esign || !getEsignSettings(ctx).enabled) return { checked: 0, changed: 0, errors: 0 };
  const g = ctx.esign;
  const pending = ctx.store
    .all<Deal>("deals")
    .filter((d) => d.esign && (d.esign.status === "sent" || d.esign.status === "viewed" || (d.esign.status === "signed" && d.status === "open")))
    .sort((a, b) => (a.esign!.updatedAt < b.esign!.updatedAt ? -1 : 1))
    .slice(0, limit);
  let changed = 0;
  let errors = 0;
  for (const d of pending) {
    try {
      const r = applyEsignStatus(ctx, g.status({ contractId: d.esign!.contractId }));
      if (r.changed) changed++;
    } catch {
      errors++;
    }
  }
  return { checked: pending.length, changed, errors };
}

/** 画面からの「状態を更新」 */
export function refreshEsign(ctx: Ctx, user: User, dealId: string) {
  const deal = getDeal(ctx, dealId);
  requireEditable(ctx, user, deal);
  if (!deal.esign) throw new ZnError("この商談には電子契約がありません", "not_found");
  const g = requireGateway(ctx);
  const remote = callGateway(() => g.status({ contractId: deal.esign!.contractId }));
  const r = applyEsignStatus(ctx, remote);
  return { ...r, deal: getDeal(ctx, dealId) };
}
