import "server-only";
import { randomUUID } from "node:crypto";
import { auditLabel, CHANNEL_LABELS } from "../audit-labels";
import {
  canonicalJson,
  CONFIRM_ITEMS,
  type ConfirmItemKey,
  fillText,
  resolveDocument,
  type DocNode,
  type KeyClause,
} from "../contract/document";
import { formatValue, validateValues, type VariableDef } from "../contract/variables";
import {
  generateOtp,
  hashOtp,
  hashToken,
  isWellFormedToken,
  safeEqualHex,
  sha256Hex,
  signPayload,
  verifyPayload,
} from "../crypto";
import { formatJstDate } from "../format";
import { renderContractPdf, type CertificateEvent } from "../pdf/render";
import { audit, type ClientInfo, maskEmail } from "./audit";
import type { Deps } from "./deps";
import { adminCompletedMessage, completedMessage, otpMessage, sendEmail } from "./notify";
import { getSettings } from "./settings";
import {
  type AccessTokenRow,
  AppError,
  type AuditRow,
  type ContractRow,
  type DocumentRow,
  type PartyRow,
  type SettingsRow,
  type TemplateVersionRow,
} from "./types";

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_REQUESTS_PER_HOUR = 5;
export const OTP_RESEND_INTERVAL_MS = 30_000;
export const OTP_LOCK_MS = 30 * 60_000;
export const SESSION_TTL_MS = 60 * 60_000;

export type TokenFailure = "invalid" | "expired" | "revoked" | "canceled";
export type TokenState =
  | { ok: true; token: AccessTokenRow; party: PartyRow; contract: ContractRow }
  | { ok: false; reason: TokenFailure };

export const TOKEN_FAILURE_MESSAGES: Record<TokenFailure, string> = {
  invalid: "このURLは無効です。URLが正しいかご確認ください。",
  expired: "このURLは有効期限が切れています。お手数ですが、送付元に再発行をご依頼ください。",
  revoked: "このURLは無効になっています。新しいURLが届いている場合はそちらをご利用ください。",
  canceled: "この契約は取り消されました。詳しくは送付元にお問い合わせください。",
};

export class SignerError extends AppError {}

/** トークンから契約を特定する。期限切れ・無効化・取消の場合は本文にアクセスさせない */
export async function resolveToken(d: Deps, token: string | null | undefined): Promise<TokenState> {
  if (!token || !isWellFormedToken(token)) return { ok: false, reason: "invalid" };
  const row = await d.db.one<AccessTokenRow>("select * from public.access_tokens where token_hash = $1", [hashToken(token)]);
  if (!row) return { ok: false, reason: "invalid" };
  const party = await d.db.one<PartyRow>("select * from public.contract_parties where id = $1", [row.contract_party_id]);
  const contract = party
    ? await d.db.one<ContractRow>("select * from public.contracts where id = $1", [party.contract_id])
    : null;
  if (!party || !contract) return { ok: false, reason: "invalid" };
  if (contract.status === "canceled") return { ok: false, reason: "canceled" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  const now = d.now().getTime();
  if (new Date(row.expires_at).getTime() < now) return { ok: false, reason: "expired" };
  if (contract.status !== "signed" && new Date(contract.expires_at).getTime() < now) return { ok: false, reason: "expired" };
  return { ok: true, token: row, party, contract };
}

async function requireToken(d: Deps, token: string | null | undefined) {
  const s = await resolveToken(d, token);
  if (!s.ok) throw new SignerError(TOKEN_FAILURE_MESSAGES[s.reason], s.reason, 403);
  return s;
}

interface SessionPayload {
  pid: string;
  th: string;
  exp: number;
}

export function createSession(d: Deps, party: PartyRow, token: AccessTokenRow): string {
  return signPayload(
    { pid: party.id, th: token.token_hash.slice(0, 32), exp: d.now().getTime() + SESSION_TTL_MS } satisfies SessionPayload,
    d.secrets.session,
  );
}

function sessionValid(d: Deps, session: string | undefined, party: PartyRow, token: AccessTokenRow): boolean {
  const p = verifyPayload<SessionPayload>(session, d.secrets.session);
  return !!p && p.pid === party.id && p.th === token.token_hash.slice(0, 32) && p.exp > d.now().getTime() && !!party.verified_at;
}

/** トークンと本人確認済みセッションの両方を要求する */
export async function requireVerified(d: Deps, token: string | null | undefined, session: string | undefined) {
  const s = await requireToken(d, token);
  if (!sessionValid(d, session, s.party, s.token)) {
    throw new SignerError("本人確認が必要です。確認コードを入力してください。", "unverified", 401);
  }
  return s;
}

function normalizeEmail(v: string | null | undefined): string {
  return (v ?? "").normalize("NFKC").trim().toLowerCase();
}

export function normalizeName(v: string | null | undefined): string {
  return (v ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

/** 本人確認の方法：メールで送った場合は登録アドレス、URLのみの場合は署名者が入力する */
function otpMode(party: PartyRow): "registered_email" | "input_email" {
  return party.delivery_channels.includes("email") && party.email ? "registered_email" : "input_email";
}

export interface PublicInfo {
  status: "sent" | "viewed" | "signed";
  title: string;
  organizationName: string;
  expiresAt: string;
  otpMode: "registered_email" | "input_email";
  emailHint: string | null;
  verified: boolean;
  privacyPolicyUrl: string | null;
}

function publicInfo(state: Extract<TokenState, { ok: true }>, settings: SettingsRow, verified: boolean): PublicInfo {
  return {
    status: state.contract.status === "signed" ? "signed" : state.contract.status === "sent" ? "sent" : "viewed",
    title: state.contract.title,
    organizationName: settings.organization_name,
    expiresAt: state.token.expires_at,
    otpMode: otpMode(state.party),
    emailHint: otpMode(state.party) === "registered_email" ? maskEmail(state.party.email) : null,
    verified,
    privacyPolicyUrl: settings.privacy_policy_url,
  };
}

/** 1. URLを開く（閲覧を記録する） */
export async function openContract(
  d: Deps,
  token: string | null | undefined,
  session: string | undefined,
  client: ClientInfo,
): Promise<{ ok: true; info: PublicInfo } | { ok: false; reason: TokenFailure; message: string }> {
  const s = await resolveToken(d, token);
  if (!s.ok) {
    return { ok: false, reason: s.reason, message: TOKEN_FAILURE_MESSAGES[s.reason] };
  }
  const settings = await getSettings(d.db);
  const first = !s.contract.viewed_at;
  if (s.contract.status === "sent") {
    await d.db.query("update public.contracts set status = 'viewed', viewed_at = now() where id = $1 and status = 'sent'", [
      s.contract.id,
    ]);
  }
  if (s.party.status === "pending") {
    await d.db.query("update public.contract_parties set status = 'viewed' where id = $1 and status = 'pending'", [s.party.id]);
  }
  await audit(d.db, {
    contractId: s.contract.id,
    actorType: "signer",
    actorId: s.party.id,
    eventType: "contract.viewed",
    payload: { first },
    client,
  });
  return { ok: true, info: publicInfo(s, settings, sessionValid(d, session, s.party, s.token)) };
}

/** 2. 本人確認：ワンタイムパスワードを送る */
export async function requestOtp(d: Deps, token: string | null | undefined, emailInput: string | null | undefined, client: ClientInfo) {
  const s = await requireToken(d, token);
  const settings = await getSettings(d.db);
  let destination: string;
  if (otpMode(s.party) === "registered_email") {
    destination = normalizeEmail(s.party.email);
  } else {
    destination = normalizeEmail(emailInput);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) throw new SignerError("メールアドレスを正しく入力してください");
    if (s.party.email && destination !== normalizeEmail(s.party.email)) {
      await audit(d.db, {
        contractId: s.contract.id,
        actorType: "signer",
        actorId: s.party.id,
        eventType: "otp.failed",
        payload: { reason: "email_mismatch", input: maskEmail(destination) },
        client,
      });
      throw new SignerError("ご入力のメールアドレスは、この契約に登録されたアドレスと一致しません。");
    }
  }
  const now = d.now();
  const recent = await d.db.query<{ created_at: string; locked_at: string | null }>(
    "select created_at, locked_at from public.otp_challenges where contract_party_id = $1 and created_at > $2 order by created_at desc",
    [s.party.id, new Date(now.getTime() - 3600_000).toISOString()],
  );
  const locked = recent.find((r) => r.locked_at && new Date(r.locked_at).getTime() > now.getTime() - OTP_LOCK_MS);
  if (locked) {
    throw new SignerError("確認コードの入力に続けて失敗したため、一時的にロックしています。30分ほど時間をおいてお試しください。", "locked", 429);
  }
  if (recent.length >= OTP_MAX_REQUESTS_PER_HOUR) {
    throw new SignerError("確認コードの送信回数が上限に達しました。しばらく時間をおいてお試しください。", "rate_limited", 429);
  }
  if (recent[0] && now.getTime() - new Date(recent[0].created_at).getTime() < OTP_RESEND_INTERVAL_MS) {
    throw new SignerError("確認コードを送信したばかりです。30秒ほどお待ちください。", "rate_limited", 429);
  }
  const id = randomUUID();
  const code = generateOtp();
  await d.db.query(
    `insert into public.otp_challenges (id, contract_party_id, channel, destination, code_hash, max_attempts, expires_at)
     values ($1, $2, 'email', $3, $4, $5, $6)`,
    [id, s.party.id, destination, hashOtp(code, id, d.secrets.otp), OTP_MAX_ATTEMPTS, new Date(now.getTime() + OTP_TTL_MS).toISOString()],
  );
  const msg = otpMessage(settings, { title: s.contract.title, code });
  const sent = await sendEmail(d, settings, { contractId: s.contract.id, partyId: s.party.id, type: "otp", to: destination, ...msg });
  await audit(d.db, {
    contractId: s.contract.id,
    actorType: "signer",
    actorId: s.party.id,
    eventType: "otp.requested",
    payload: { channel: "email", destination: maskEmail(destination), delivered: sent },
    client,
  });
  if (!sent) throw new SignerError("確認コードのメールを送信できませんでした。時間をおいて再度お試しください。", "send_failed", 502);
  return { destination: maskEmail(destination) };
}

/** 2. 本人確認：ワンタイムパスワードを検証し、セッションを発行する */
export async function verifyOtp(d: Deps, token: string | null | undefined, code: string, client: ClientInfo) {
  const s = await requireToken(d, token);
  const now = d.now();
  const ch = await d.db.one<{
    id: string;
    destination: string;
    code_hash: string;
    attempts: number;
    max_attempts: number;
    expires_at: string;
    locked_at: string | null;
  }>(
    `select * from public.otp_challenges where contract_party_id = $1 and verified_at is null
     order by created_at desc limit 1`,
    [s.party.id],
  );
  if (!ch) throw new SignerError("確認コードを送信してください。");
  if (ch.locked_at) throw new SignerError("入力回数の上限を超えたためロックされています。30分ほど時間をおいて、コードを再送してください。", "locked", 429);
  if (new Date(ch.expires_at).getTime() < now.getTime()) {
    throw new SignerError("確認コードの有効期限（10分）が切れました。コードを再送してください。", "otp_expired");
  }
  const normalized = code.normalize("NFKC").replace(/\D/g, "");
  const ok = normalized.length === 6 && safeEqualHex(hashOtp(normalized, ch.id, d.secrets.otp), ch.code_hash);
  const attempts = ch.attempts + 1;
  if (!ok) {
    const lock = attempts >= ch.max_attempts;
    await d.db.query("update public.otp_challenges set attempts = $2, locked_at = $3 where id = $1", [
      ch.id,
      attempts,
      lock ? now.toISOString() : null,
    ]);
    await audit(d.db, {
      contractId: s.contract.id,
      actorType: "signer",
      actorId: s.party.id,
      eventType: lock ? "otp.locked" : "otp.failed",
      payload: { attempts, remaining: Math.max(0, ch.max_attempts - attempts) },
      client,
    });
    if (lock) throw new SignerError("確認コードの入力に5回失敗したため、ロックしました。30分ほど時間をおいてお試しください。", "locked", 429);
    throw new SignerError(`確認コードが正しくありません（あと${ch.max_attempts - attempts}回入力できます）。`, "otp_invalid");
  }
  await d.db.query("update public.otp_challenges set attempts = $2, verified_at = now() where id = $1", [ch.id, attempts]);
  let party = s.party;
  if (s.contract.status !== "signed") {
    party = (await d.db.one<PartyRow>(
      `update public.contract_parties set verified_at = now(), verified_email = $2, verified_method = 'email_otp',
         status = case when status in ('pending', 'viewed') then 'verified' else status end
       where id = $1 returning *`,
      [s.party.id, ch.destination],
    ))!;
  } else {
    party = { ...party, verified_at: party.verified_at ?? now.toISOString() };
  }
  await audit(d.db, {
    contractId: s.contract.id,
    actorType: "signer",
    actorId: s.party.id,
    eventType: "otp.verified",
    payload: { method: "email_otp", destination: maskEmail(ch.destination) },
    client,
  });
  return { session: createSession(d, party, s.token) };
}

interface VersionWithName extends TemplateVersionRow {
  template_name: string;
}

async function loadContractContent(d: Deps, contract: ContractRow) {
  const version = await d.db.one<VersionWithName>(
    `select v.*, t.name as template_name from public.template_versions v join public.templates t on t.id = v.template_id where v.id = $1`,
    [contract.template_version_id],
  );
  const rows = await d.db.query<{ variable_key: string; value: string; entered_by: string }>(
    "select variable_key, value, entered_by from public.contract_values where contract_id = $1",
    [contract.id],
  );
  const values = Object.fromEntries(rows.map((r) => [r.variable_key, r.value]));
  return { version: version!, values };
}

function makeResolver(defs: VariableDef[], values: Record<string, string>, system: Record<string, string>) {
  const map = new Map(defs.map((v) => [v.key, v]));
  return (key: string) => system[key] ?? (values[key] !== undefined && values[key] !== "" ? formatValue(map.get(key), values[key]) : undefined);
}

function systemValues(settings: SettingsRow, contract: ContractRow, signedAt?: string | null): Record<string, string> {
  return {
    発注者名: settings.organization_name,
    契約ID: contract.id,
    契約締結日: signedAt ? formatJstDate(signedAt) : "",
  };
}

export interface SignerDocument {
  title: string;
  organizationName: string;
  status: "sent" | "viewed" | "signed";
  signerName: string;
  verifiedEmail: string | null;
  body: DocNode;
  signerVariables: (VariableDef & { value: string })[];
  keyClauses: KeyClause[];
  confirmItems: { key: ConfirmItemKey; label: string; text: string }[];
  readCompleted: boolean;
  signedAt: string | null;
  privacyPolicyUrl: string | null;
  documentSha256: string | null;
}

/** 3. 契約書の全文（本人確認済みのセッションが必要） */
export async function getSignerDocument(d: Deps, token: string | null | undefined, session: string | undefined): Promise<SignerDocument> {
  const s = await requireVerified(d, token, session);
  const settings = await getSettings(d.db);
  const { version, values } = await loadContractContent(d, s.contract);
  const resolve = makeResolver(version.variables, values, systemValues(settings, s.contract, s.contract.signed_at));
  const doc = s.contract.status === "signed"
    ? await d.db.one<DocumentRow>("select * from public.documents where contract_id = $1 and kind = 'final'", [s.contract.id])
    : null;
  return {
    title: s.contract.title,
    organizationName: settings.organization_name,
    status: s.contract.status === "signed" ? "signed" : s.contract.status === "sent" ? "sent" : "viewed",
    signerName: s.party.name,
    verifiedEmail: s.party.verified_email ? maskEmail(s.party.verified_email) : null,
    body: resolveDocument(version.body, resolve),
    signerVariables: version.variables
      .filter((v) => v.filledBy === "signer")
      .map((v) => ({ ...v, value: values[v.key] ?? v.defaultValue ?? "" })),
    keyClauses: version.key_clauses,
    confirmItems: (Object.keys(CONFIRM_ITEMS) as ConfirmItemKey[])
      .filter((k) => version.confirm_screen_items[k])
      .map((k) => ({ key: k, label: CONFIRM_ITEMS[k], text: fillText(version.confirm_screen_items[k] ?? "", resolve) })),
    readCompleted: !!s.party.read_completed_at,
    signedAt: s.contract.signed_at,
    privacyPolicyUrl: settings.privacy_policy_url,
    documentSha256: doc?.sha256 ?? null,
  };
}

/** 3. 本文を最後までスクロールしたことを記録 */
export async function markRead(d: Deps, token: string | null | undefined, session: string | undefined, client: ClientInfo) {
  const s = await requireVerified(d, token, session);
  if (s.contract.status === "signed" || s.party.read_completed_at) return;
  await d.db.query("update public.contract_parties set read_completed_at = now() where id = $1 and read_completed_at is null", [
    s.party.id,
  ]);
  await audit(d.db, { contractId: s.contract.id, actorType: "signer", actorId: s.party.id, eventType: "document.read_completed", client });
}

/** 4. 署名者の入力 */
export async function saveSignerValues(
  d: Deps,
  token: string | null | undefined,
  session: string | undefined,
  input: Record<string, string>,
  client: ClientInfo,
) {
  const s = await requireVerified(d, token, session);
  if (s.contract.status === "signed") throw new SignerError("署名済みの契約は変更できません", "conflict", 409);
  const { version } = await loadContractContent(d, s.contract);
  const { values, errors } = validateValues(version.variables, input, "signer");
  if (Object.keys(errors).length) return { ok: false as const, errors };
  await d.db.tx(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx.query(
        `insert into public.contract_values (contract_id, variable_key, value, entered_by) values ($1, $2, $3, 'signer')
         on conflict (contract_id, variable_key) do update set value = excluded.value, updated_at = now()
         where public.contract_values.entered_by = 'signer'`,
        [s.contract.id, key, value],
      );
    }
    if (Object.keys(values).length) {
      await audit(tx, {
        contractId: s.contract.id,
        actorType: "signer",
        actorId: s.party.id,
        eventType: "values.saved",
        payload: { values },
        client,
      });
    }
  });
  return { ok: true as const, values };
}

/** 確認用PDF（署名前・透かし入り） */
export async function previewPdf(d: Deps, token: string | null | undefined, session: string | undefined, client: ClientInfo) {
  const s = await requireVerified(d, token, session);
  const settings = await getSettings(d.db);
  const { version, values } = await loadContractContent(d, s.contract);
  const resolve = makeResolver(version.variables, values, systemValues(settings, s.contract));
  const bytes = await renderContractPdf({
    title: s.contract.title,
    body: resolveDocument(version.body, resolve),
    organizationName: settings.organization_name,
    contractId: s.contract.id,
    preview: true,
  });
  await audit(d.db, {
    contractId: s.contract.id,
    actorType: "signer",
    actorId: s.party.id,
    eventType: "document.preview_downloaded",
    client,
  });
  return bytes;
}

export interface FinalizeInput {
  consents: { content: boolean; privacy: boolean; keyClauses: Record<string, boolean> };
  signedName: string;
  signatureImage?: string | null;
}

function decodeSignatureImage(v: string | null | undefined): Uint8Array | null {
  if (!v) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(v);
  if (!m?.[1]) throw new SignerError("手書きサインの形式が正しくありません");
  const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
  if (bytes.length > 300_000) throw new SignerError("手書きサインの画像が大きすぎます");
  const magic = [0x89, 0x50, 0x4e, 0x47];
  if (!magic.every((b, i) => bytes[i] === b)) throw new SignerError("手書きサインの形式が正しくありません");
  return bytes;
}

const CERT_EVENTS = new Set(["contract.sent", "contract.viewed", "otp.verified", "document.read_completed", "values.saved", "consent.given"]);

function certificateEvents(events: AuditRow[]): CertificateEvent[] {
  const out: CertificateEvent[] = [];
  let viewed = false;
  for (const e of events) {
    if (!CERT_EVENTS.has(e.event_type)) continue;
    if (e.event_type === "contract.viewed") {
      if (viewed) continue;
      viewed = true;
    }
    let detail = "";
    const p = e.payload;
    if (e.event_type === "contract.sent") detail = `送付方法：${CHANNEL_LABELS[String(p.channel)] ?? String(p.channel)}`;
    if (e.event_type === "contract.viewed") detail = "署名URLを初めて開いた";
    if (e.event_type === "otp.verified") detail = `メールのワンタイムパスワード（${String(p.destination ?? "")}）`;
    if (e.event_type === "values.saved") detail = `入力項目：${Object.keys((p.values as object) ?? {}).join("、")}`;
    if (e.event_type === "consent.given") detail = String(p.summary ?? "");
    out.push({ at: e.created_at, label: auditLabel(e.event_type), detail, ip: e.ip });
  }
  return out;
}

/** 5〜8. 同意・署名・最終確認を経て、確定版PDFを生成して締結する */
export async function finalizeSignature(
  d: Deps,
  token: string | null | undefined,
  session: string | undefined,
  input: FinalizeInput,
  client: ClientInfo,
) {
  const s = await requireVerified(d, token, session);
  if (s.contract.status === "signed") throw new SignerError("この契約はすでに署名済みです", "conflict", 409);
  if (!s.party.read_completed_at) throw new SignerError("契約書を最後までご確認ください", "not_read");
  const settings = await getSettings(d.db);
  const { version, values } = await loadContractContent(d, s.contract);

  const signerCheck = validateValues(version.variables, values, "signer");
  const adminCheck = validateValues(version.variables, values, "admin");
  const errs = { ...adminCheck.errors, ...signerCheck.errors };
  if (Object.keys(errs).length) throw new SignerError(Object.values(errs).join("\n"), "invalid_values");

  if (!input.consents.content) throw new SignerError("「契約書の内容をすべて確認しました」にチェックしてください", "consent");
  if (!input.consents.privacy) throw new SignerError("「個人情報の取扱いに同意します」にチェックしてください", "consent");
  for (const k of version.key_clauses) {
    if (!input.consents.keyClauses?.[k.id]) throw new SignerError(`重要事項「${k.title}」の確認にチェックしてください`, "consent");
  }
  if (!normalizeName(input.signedName) || normalizeName(input.signedName) !== normalizeName(s.party.name)) {
    throw new SignerError(`ご入力の氏名が、この契約の署名者（${s.party.name} 様）と一致しません`, "name_mismatch");
  }
  const signatureBytes = decodeSignatureImage(input.signatureImage);
  const consents = {
    content: true,
    privacy: true,
    key_clauses: Object.fromEntries(version.key_clauses.map((k) => [k.id, { title: k.title, confirmed: true }])),
  };
  await audit(d.db, {
    contractId: s.contract.id,
    actorType: "signer",
    actorId: s.party.id,
    eventType: "consent.given",
    payload: {
      consents,
      summary: `契約内容の確認・個人情報の取扱い${version.key_clauses.length ? `・重要事項${version.key_clauses.length}件` : ""}に同意`,
    },
    client,
  });

  const signedAt = d.now().toISOString();
  const verifiedEmail = s.party.verified_email ?? s.party.email ?? "";
  const resolve = makeResolver(version.variables, values, systemValues(settings, s.contract, signedAt));
  const body = resolveDocument(version.body, resolve);

  // 契約内容（本文・値・署名者・日時）のハッシュと、それへのタイムスタンプ
  const contentHash = sha256Hex(
    canonicalJson({
      contract_id: s.contract.id,
      template_version_id: version.id,
      template_body_hash: s.contract.template_body_hash,
      body,
      values,
      signer: { name: s.party.name, signed_name: input.signedName.trim(), email: verifiedEmail },
      signed_at: signedAt,
    }),
  );
  let contentTs: Awaited<ReturnType<Deps["timestamp"]>> | null = null;
  try {
    contentTs = await d.timestamp(contentHash);
  } catch {
    contentTs = null;
  }

  const events = await d.db.query<AuditRow>("select * from public.audit_events where contract_id = $1 order by seq", [s.contract.id]);
  const certEvents = certificateEvents(events);
  certEvents.push({ at: signedAt, label: "署名", detail: `氏名の入力：${input.signedName.trim()}${signatureBytes ? "（手書きサインあり）" : ""}`, ip: client.ip });

  const pdf = await renderContractPdf({
    title: s.contract.title,
    body,
    organizationName: settings.organization_name,
    contractId: s.contract.id,
    signer: { name: input.signedName.trim(), email: verifiedEmail, signedAt, signatureImagePng: signatureBytes },
    certificate: {
      contractId: s.contract.id,
      templateName: version.template_name,
      templateVersion: version.version_no,
      templateBodyHash: s.contract.template_body_hash,
      organizationName: settings.organization_name,
      signerName: s.party.name,
      signerEmail: verifiedEmail,
      verificationMethod: "メールアドレスへのワンタイムパスワード（6桁・有効期限10分）",
      events: certEvents,
      contentHash,
      contentTimestamp: contentTs ? { time: contentTs.genTime.toISOString(), tsaUrl: contentTs.tsaUrl, serial: contentTs.serial } : null,
      verifyUrl: `${d.appUrl}/verify`,
    },
    createdAt: new Date(signedAt),
  });
  const sha256 = sha256Hex(pdf);
  const storagePath = `contracts/${s.contract.id}/${sha256}.pdf`;
  await d.storage.create(storagePath, pdf, "application/pdf");

  const amountKey = version.amount_variable_key;
  const dateKey = version.transaction_date_variable_key;
  const cpKey = version.counterparty_variable_key;
  const documentId = await d.db.tx(async (tx) => {
    await tx.query(
      `update public.contracts set amount = coalesce($2::numeric, amount), transaction_date = coalesce($3::date, transaction_date),
         counterparty_name = coalesce($4, counterparty_name) where id = $1`,
      [
        s.contract.id,
        amountKey && values[amountKey] ? values[amountKey] : null,
        dateKey && values[dateKey] ? values[dateKey] : null,
        cpKey && values[cpKey] ? values[cpKey] : null,
      ],
    );
    const r = await tx.one<{ id: string }>(
      "select public.finalize_signature($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as id",
      [
        s.party.id,
        input.signedName.trim(),
        input.signatureImage ?? null,
        JSON.stringify(consents),
        signedAt,
        client.ip,
        client.userAgent,
        storagePath,
        sha256,
        pdf.length,
        contentHash,
      ],
    );
    if (contentTs) {
      await tx.query(
        `insert into public.document_timestamps (document_id, contract_id, target, hashed_message, tsa_url, tsa_token, tsa_time, tsa_serial)
         values ($1, $2, 'content', $3, $4, $5, $6, $7)`,
        [r!.id, s.contract.id, contentHash, contentTs.tsaUrl, contentTs.token, contentTs.genTime.toISOString(), contentTs.serial],
      );
    }
    return r!.id;
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/contract is signed/.test(msg)) throw new SignerError("この契約はすでに署名済みです", "conflict", 409);
    if (/contract is canceled/.test(msg)) throw new SignerError(TOKEN_FAILURE_MESSAGES.canceled, "canceled", 403);
    if (/expired/.test(msg)) throw new SignerError(TOKEN_FAILURE_MESSAGES.expired, "expired", 403);
    throw e;
  });

  const timestamped = await stampDocument(d, { id: documentId, contract_id: s.contract.id, sha256 });

  // 署名者と管理者へ確定版PDFを送付
  const attachment = { filename: `${s.contract.title}.pdf`.replace(/[\\/:*?"<>|]/g, "_"), content: pdf, contentType: "application/pdf" };
  if (verifiedEmail) {
    await sendEmail(d, settings, {
      contractId: s.contract.id,
      partyId: s.party.id,
      type: "completed",
      to: verifiedEmail,
      ...completedMessage(settings, {
        title: s.contract.title,
        signerName: s.party.name,
        signedAt,
        sha256,
        verifyUrl: `${d.appUrl}/verify`,
      }),
      attachments: [attachment],
    });
  }
  if (settings.admin_notify_email) {
    await sendEmail(d, settings, {
      contractId: s.contract.id,
      type: "admin_completed",
      to: settings.admin_notify_email,
      ...adminCompletedMessage(settings, {
        title: s.contract.title,
        signerName: s.party.name,
        signedAt,
        sha256,
        adminUrl: `${d.appUrl}/admin/contracts/${s.contract.id}`,
        timestamped,
      }),
      attachments: [attachment],
    });
  }
  return { sha256, signedAt, documentId, timestamped };
}

/** 確定版PDFのハッシュにタイムスタンプを付与する。失敗したら再試行キューに残す */
export async function stampDocument(d: Deps, doc: Pick<DocumentRow, "id" | "contract_id" | "sha256">): Promise<boolean> {
  try {
    const ts = await d.timestamp(doc.sha256);
    await d.db.tx(async (tx) => {
      await tx.query(
        `insert into public.document_timestamps (document_id, contract_id, target, hashed_message, tsa_url, tsa_token, tsa_time, tsa_serial)
         values ($1, $2, 'pdf', $3, $4, $5, $6, $7)`,
        [doc.id, doc.contract_id, doc.sha256, ts.tsaUrl, ts.token, ts.genTime.toISOString(), ts.serial],
      );
      await tx.query("update public.timestamp_jobs set done_at = now(), attempts = attempts + 1, last_error = null where document_id = $1", [
        doc.id,
      ]);
      await audit(tx, {
        contractId: doc.contract_id,
        actorType: "system",
        eventType: "timestamp.granted",
        payload: { target: "pdf", sha256: doc.sha256, tsa_time: ts.genTime.toISOString(), tsa_url: ts.tsaUrl, serial: ts.serial },
      });
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await d.db.query(
      `update public.timestamp_jobs set attempts = attempts + 1, last_error = $2,
         next_attempt_at = now() + least(interval '6 hours', interval '5 minutes' * power(2, attempts))
       where document_id = $1`,
      [doc.id, msg.slice(0, 500)],
    );
    await audit(d.db, { contractId: doc.contract_id, actorType: "system", eventType: "timestamp.failed", payload: { target: "pdf", error: msg.slice(0, 300) } });
    return false;
  }
}

/** 再試行キューの処理（cronから呼ぶ） */
export async function processTimestampJobs(d: Deps, limit = 20) {
  const jobs = await d.db.query<{ document_id: string; contract_id: string; sha256: string }>(
    `select j.document_id, doc.contract_id, doc.sha256 from public.timestamp_jobs j
     join public.documents doc on doc.id = j.document_id
     where j.done_at is null and j.next_attempt_at <= now() order by j.next_attempt_at limit $1`,
    [limit],
  );
  let ok = 0;
  for (const j of jobs) if (await stampDocument(d, { id: j.document_id, contract_id: j.contract_id, sha256: j.sha256 })) ok++;
  return { processed: jobs.length, succeeded: ok };
}

/** 確定版PDFのダウンロード（署名者） */
export async function downloadSignedPdf(d: Deps, token: string | null | undefined, session: string | undefined, client: ClientInfo) {
  const s = await requireVerified(d, token, session);
  if (s.contract.status !== "signed") throw new SignerError("まだ署名が完了していません", "not_signed", 409);
  const doc = await d.db.one<DocumentRow>("select * from public.documents where contract_id = $1 and kind = 'final'", [s.contract.id]);
  if (!doc) throw new SignerError("確定版PDFが見つかりません", "not_found", 404);
  const bytes = await d.storage.read(doc.storage_path);
  if (sha256Hex(bytes) !== doc.sha256) throw new Error("保存されたPDFのハッシュが記録と一致しません");
  await audit(d.db, { contractId: s.contract.id, actorType: "signer", actorId: s.party.id, eventType: "document.downloaded", client });
  return { bytes, filename: `${s.contract.title}.pdf` };
}
