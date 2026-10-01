import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { VariableDef } from "../contract/variables";
import { audit } from "./audit";
import { createContract, getSigningUrl } from "./contracts";
import type { Db } from "./db";
import type { Deps } from "./deps";
import { AppError, type ContractRow, type DocumentRow, type TemplateRow } from "./types";

/**
 * 外部システム（顧客管理）との連携。
 * - 連携API：Authorization: Bearer <INTEGRATION_API_KEY> で、テンプレートの一覧・契約の作成・状態の確認ができる
 * - 通知：署名完了・取消・期限切れを INTEGRATION_WEBHOOK_URL へ送る（HMAC-SHA256 の署名付き。失敗したら定期実行で再送）
 */

export function integrationEnabled(d: Deps): boolean {
  return !!d.integration.apiKey;
}

/** APIキーの照合（長さの違いも含めて一定時間で比較する） */
export function checkApiKey(d: Deps, authorization: string | null): boolean {
  const key = d.integration.apiKey;
  if (!key || !authorization) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m?.[1]) return false;
  const a = createHmac("sha256", "integration-key").update(m[1]).digest();
  const b = createHmac("sha256", "integration-key").update(key).digest();
  return timingSafeEqual(a, b);
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  versionNo: number;
  variables: Pick<VariableDef, "key" | "type" | "filledBy" | "required" | "options">[];
}

export async function listIntegrationTemplates(db: Db): Promise<IntegrationTemplate[]> {
  const rows = await db.query<TemplateRow & { version_no: number; variables: VariableDef[] }>(
    `select t.*, v.version_no, v.variables from public.templates t
     join public.template_versions v on v.id = t.current_version_id
     where t.status = 'active' and v.published_at is not null order by t.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    versionNo: r.version_no,
    variables: r.variables.map((v) => ({ key: v.key, type: v.type, filledBy: v.filledBy, required: v.required, options: v.options })),
  }));
}

export interface IntegrationContractStatus {
  contractId: string;
  externalRef: string | null;
  title: string;
  status: string;
  signedAt: string | null;
  canceledAt: string | null;
  expiresAt: string;
  sha256: string | null;
  url: string | null;
  adminUrl: string;
}

async function statusOf(d: Deps, c: ContractRow, withUrl: boolean): Promise<IntegrationContractStatus> {
  const doc = await d.db.one<DocumentRow>("select * from public.documents where contract_id = $1 order by created_at limit 1", [c.id]);
  const status = c.effective_status ?? c.status;
  return {
    contractId: c.id,
    externalRef: c.external_ref,
    title: c.title,
    status,
    signedAt: c.signed_at,
    canceledAt: c.canceled_at,
    expiresAt: c.expires_at,
    sha256: doc?.sha256 ?? null,
    url: withUrl && (status === "sent" || status === "viewed") ? await getSigningUrl(d, c.id) : null,
    adminUrl: `${d.appUrl}/admin/contracts/${c.id}`,
  };
}

export async function getIntegrationStatus(d: Deps, q: { contractId?: string | null; externalRef?: string | null }) {
  let c: ContractRow | null = null;
  if (q.contractId) {
    if (!/^[0-9a-f-]{36}$/i.test(q.contractId)) throw new AppError("契約IDの形式が正しくありません", "bad_request", 400);
    c = await d.db.one<ContractRow>("select * from public.contracts_view where id = $1", [q.contractId]);
  } else if (q.externalRef) {
    c = await d.db.one<ContractRow>(
      "select * from public.contracts_view where external_ref = $1 order by created_at desc limit 1",
      [q.externalRef],
    );
  }
  if (!c) throw new AppError("契約が見つかりません", "not_found", 404);
  return statusOf(d, c, true);
}

export interface IntegrationCreateInput {
  templateId: string;
  externalRef: string;
  signer: { name: string; email?: string | null; phone?: string | null; company?: string | null };
  values?: Record<string, string>;
  title?: string;
  sendEmail?: boolean;
  expiresInDays?: number;
}

function parseCreateInput(body: unknown): IntegrationCreateInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const signer = (b.signer ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
  const externalRef = str(b.externalRef).trim();
  if (!externalRef || externalRef.length > 200) throw new AppError("externalRef（依頼元の識別子）を指定してください", "bad_request", 400);
  if (!str(b.templateId)) throw new AppError("templateId を指定してください", "bad_request", 400);
  const values: Record<string, string> = {};
  if (b.values && typeof b.values === "object") {
    for (const [k, v] of Object.entries(b.values as Record<string, unknown>)) values[k] = str(v);
  }
  return {
    templateId: str(b.templateId),
    externalRef,
    signer: { name: str(signer.name), email: str(signer.email) || null, phone: str(signer.phone) || null, company: str(signer.company) || null },
    values,
    title: str(b.title) || undefined,
    sendEmail: b.sendEmail === true,
    expiresInDays: typeof b.expiresInDays === "number" ? b.expiresInDays : undefined,
  };
}

/**
 * 契約の作成（連携API）。同じ externalRef で署名待ちの契約があれば、新しく作らずにそれを返す
 * （依頼元の再送で二重に作らないため）。
 */
export async function createIntegrationContract(d: Deps, body: unknown) {
  const input = parseCreateInput(body);
  const existing = await d.db.one<ContractRow>(
    `select * from public.contracts_view where external_ref = $1 and effective_status in ('sent', 'viewed', 'signed')
     order by created_at desc limit 1`,
    [input.externalRef],
  );
  if (existing) return { ...(await statusOf(d, existing, true)), emailSent: false, created: false };
  const r = await createContract(d, null, {
    templateId: input.templateId,
    signer: input.signer,
    values: input.values ?? {},
    channels: input.sendEmail ? ["url", "email"] : ["url"],
    expiresInDays: input.expiresInDays,
    title: input.title,
    externalRef: input.externalRef,
  });
  const c = await d.db.one<ContractRow>("select * from public.contracts_view where id = $1", [r.contractId]);
  return { ...(await statusOf(d, c!, false)), url: r.url, emailSent: !!r.sent.email, created: true };
}

// ---------------------------------------------------------------------------
// 通知（Webhook）
// ---------------------------------------------------------------------------

export type WebhookEvent = "contract.signed" | "contract.canceled" | "contract.expired";

export function signWebhookPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** 連携元から作成された契約なら、通知をキューに入れて送る（送れなかったら定期実行で再送） */
export async function notifyIntegration(d: Deps, contractId: string, event: WebhookEvent): Promise<void> {
  if (!d.integration.webhookUrl || !d.integration.webhookSecret) return;
  const c = await d.db.one<ContractRow>("select * from public.contracts_view where id = $1", [contractId]);
  if (!c?.external_ref) return;
  const s = await statusOf(d, c, false);
  const payload = {
    event,
    contractId: s.contractId,
    externalRef: s.externalRef,
    title: s.title,
    status: s.status,
    signedAt: s.signedAt,
    canceledAt: s.canceledAt,
    sha256: s.sha256,
    adminUrl: s.adminUrl,
  };
  const row = await d.db.one<{ id: string }>(
    `insert into public.webhook_deliveries (contract_id, event, payload) values ($1, $2, $3)
     on conflict (contract_id, event) do nothing returning id`,
    [contractId, event, JSON.stringify(payload)],
  );
  if (row) await deliverOne(d, row.id);
}

/** 通知の失敗で本来の処理（署名・取消など）を失敗させない。未送信分は定期実行で再送する */
export async function notifyIntegrationSafely(d: Deps, contractId: string, event: WebhookEvent): Promise<void> {
  try {
    await notifyIntegration(d, contractId, event);
  } catch (e) {
    console.warn("[integration] notify failed", contractId, event, e instanceof Error ? e.message : e);
  }
}

async function deliverOne(d: Deps, id: string): Promise<boolean> {
  const w = await d.db.one<{ id: string; contract_id: string; event: string; payload: Record<string, unknown>; attempts: number }>(
    "select * from public.webhook_deliveries where id = $1 and delivered_at is null",
    [id],
  );
  if (!w || !d.integration.webhookUrl || !d.integration.webhookSecret) return false;
  const payload = JSON.stringify({ ...w.payload, deliveryId: w.id, sentAt: d.now().toISOString() });
  const body = JSON.stringify({ kind: "esign.webhook", payload, signature: signWebhookPayload(d.integration.webhookSecret, payload) });
  try {
    const res = await d.integration.fetch(d.integration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Apps Script はエラーでも 200 を返すため、本文の ok も確かめる
    let reply: { ok?: boolean; error?: string } | null = null;
    try {
      reply = JSON.parse(text) as { ok?: boolean; error?: string };
    } catch {
      reply = null;
    }
    if (reply?.ok === false) throw new Error(reply.error ?? "rejected");
    await d.db.query("update public.webhook_deliveries set delivered_at = now(), attempts = attempts + 1, last_error = null where id = $1", [w.id]);
    await audit(d.db, { contractId: w.contract_id, actorType: "system", eventType: "integration.notified", payload: { event: w.event } });
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await d.db.query(
      `update public.webhook_deliveries set attempts = attempts + 1, last_error = $2,
         next_attempt_at = now() + least(interval '6 hours', interval '5 minutes' * power(2, attempts))
       where id = $1`,
      [w.id, msg],
    );
    return false;
  }
}

/** 未送信の通知の再送（cronから呼ぶ） */
export async function deliverPendingWebhooks(d: Deps, limit = 20) {
  if (!d.integration.webhookUrl || !d.integration.webhookSecret) return { processed: 0, succeeded: 0 };
  const rows = await d.db.query<{ id: string }>(
    `select id from public.webhook_deliveries where delivered_at is null and next_attempt_at <= now()
     order by next_attempt_at limit $1`,
    [limit],
  );
  let ok = 0;
  for (const r of rows) if (await deliverOne(d, r.id)) ok++;
  return { processed: rows.length, succeeded: ok };
}
