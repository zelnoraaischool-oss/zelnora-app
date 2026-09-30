import "server-only";
import { decryptString, encryptString, generateToken, hashToken } from "../crypto";
import { validateValues } from "../contract/variables";
import { audit, type ClientInfo } from "./audit";
import { upsertContact, type ContactInput } from "./contacts";
import type { Db } from "./db";
import type { Deps } from "./deps";
import { inviteMessage, reminderMessage, sendEmail } from "./notify";
import { getSettings } from "./settings";
import {
  type AccessTokenRow,
  type Actor,
  AppError,
  type AuditRow,
  type ContractRow,
  type DocumentRow,
  type NotificationRow,
  type PartyRow,
  type TemplateRow,
  type TemplateVersionRow,
  type TimestampRow,
} from "./types";

export type DeliveryChannel = "url" | "email";

export function signingUrl(appUrl: string, token: string): string {
  // トークンはURLのフラグメントに置く（サーバーのアクセスログやRefererに残らない）
  return `${appUrl}/s#${token}`;
}

export interface CreateContractInput {
  templateId: string;
  signer: ContactInput & { contactId?: string };
  values: Record<string, string>;
  channels: DeliveryChannel[];
  expiresInDays?: number;
  title?: string;
}

async function issueToken(db: Db, d: Deps, partyId: string, expiresAt: string, actorId: string | null) {
  const token = generateToken();
  await db.query(
    `insert into public.access_tokens (contract_party_id, token_hash, token_ciphertext, expires_at, created_by)
     values ($1, $2, $3, $4, $5)`,
    [partyId, hashToken(token), encryptString(token, d.secrets.tokenEncryption), expiresAt, actorId],
  );
  return token;
}

export async function createContract(d: Deps, actor: Actor, input: CreateContractInput, client?: ClientInfo) {
  const settings = await getSettings(d.db);
  const channels = [...new Set(input.channels)].filter((c): c is DeliveryChannel => c === "url" || c === "email");
  if (!channels.length) channels.push("url");
  const days = input.expiresInDays ?? settings.default_expiry_days;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError("有効期限は1〜365日で指定してください");

  const template = await d.db.one<TemplateRow>("select * from public.templates where id = $1", [input.templateId]);
  if (!template || template.status !== "active") throw new AppError("テンプレートが見つかりません", "not_found", 404);
  if (!template.current_version_id) throw new AppError("このテンプレートはまだ公開されていません");
  const version = await d.db.one<TemplateVersionRow>("select * from public.template_versions where id = $1", [
    template.current_version_id,
  ]);
  if (!version?.published_at || !version.body_hash) throw new AppError("公開済みのバージョンがありません");

  const { values, errors } = validateValues(version.variables, input.values, "admin");
  if (Object.keys(errors).length) {
    throw new AppError(Object.values(errors).join("\n"), "invalid_values");
  }
  if (channels.includes("email") && !input.signer.email) {
    throw new AppError("メールで送信するには署名者のメールアドレスが必要です");
  }

  const expiresAt = new Date(d.now().getTime() + days * 86400_000).toISOString();
  const amountKey = version.amount_variable_key;
  const dateKey = version.transaction_date_variable_key;
  const cpKey = version.counterparty_variable_key;

  const result = await d.db.tx(async (tx) => {
    const contact = await upsertContact(
      tx,
      actor,
      { ...input.signer, id: input.signer.contactId },
      client,
    );
    const counterparty = (cpKey && values[cpKey]) || contact.company || contact.name;
    const title = input.title?.trim() || `${template.name}（${contact.name} 様）`;
    const contract = await tx.one<ContractRow>(
      `insert into public.contracts (template_version_id, template_body_hash, title, status, amount, transaction_date,
         counterparty_name, delivery_channels, expires_at, sent_at, created_by)
       values ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, now(), $9) returning *`,
      [
        version.id,
        version.body_hash,
        title,
        amountKey && values[amountKey] ? values[amountKey] : null,
        dateKey && values[dateKey] ? values[dateKey] : null,
        counterparty,
        channels,
        expiresAt,
        actor.id,
      ],
    );
    const party = await tx.one<PartyRow>(
      `insert into public.contract_parties (contract_id, contact_id, name, email, phone, company, delivery_channels)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [contract!.id, contact.id, contact.name, contact.email, contact.phone, contact.company, channels],
    );
    for (const [key, value] of Object.entries(values)) {
      await tx.query(
        "insert into public.contract_values (contract_id, variable_key, value, entered_by) values ($1, $2, $3, 'admin')",
        [contract!.id, key, value],
      );
    }
    const token = await issueToken(tx, d, party!.id, expiresAt, actor.id);
    await audit(tx, {
      contractId: contract!.id,
      actorType: "admin",
      actorId: actor.id,
      eventType: "contract.created",
      payload: {
        template_id: template.id,
        template_version_id: version.id,
        version_no: version.version_no,
        template_body_hash: version.body_hash,
        signer: { name: contact.name, email: contact.email },
        values,
        expires_at: expiresAt,
      },
      client,
    });
    await audit(tx, {
      contractId: contract!.id,
      actorType: "admin",
      actorId: actor.id,
      eventType: "token.issued",
      payload: { expires_at: expiresAt },
      client,
    });
    return { contract: contract!, party: party!, token, values };
  });

  const url = signingUrl(d.appUrl, result.token);
  const sent: Record<string, boolean> = {};
  for (const ch of channels) {
    if (ch === "url") {
      await audit(d.db, {
        contractId: result.contract.id,
        actorType: "admin",
        actorId: actor.id,
        eventType: "contract.sent",
        payload: { channel: "url" },
        client,
      });
      sent.url = true;
    }
    if (ch === "email" && result.party.email) {
      const msg = inviteMessage(settings, version, {
        title: result.contract.title,
        signerName: result.party.name,
        url,
        expiresAt,
        values: result.values,
      });
      const ok = await sendEmail(d, settings, {
        contractId: result.contract.id,
        partyId: result.party.id,
        type: "invite",
        to: result.party.email,
        ...msg,
      });
      if (ok) {
        await audit(d.db, {
          contractId: result.contract.id,
          actorType: "admin",
          actorId: actor.id,
          eventType: "contract.sent",
          payload: { channel: "email" },
          client,
        });
      }
      sent.email = ok;
    }
  }
  return { contractId: result.contract.id, url, sent };
}

export async function getActiveToken(db: Db, partyId: string) {
  return db.one<AccessTokenRow>(
    `select * from public.access_tokens where contract_party_id = $1 and revoked_at is null
     order by created_at desc limit 1`,
    [partyId],
  );
}

/** 管理者用：現在有効な署名URLを取り出す（暗号化して保存したトークンを復号） */
export async function getSigningUrl(d: Deps, contractId: string): Promise<string | null> {
  const party = await d.db.one<PartyRow>("select * from public.contract_parties where contract_id = $1 order by sign_order limit 1", [
    contractId,
  ]);
  if (!party) return null;
  const t = await getActiveToken(d.db, party.id);
  if (!t?.token_ciphertext || new Date(t.expires_at) < d.now()) return null;
  try {
    return signingUrl(d.appUrl, decryptString(t.token_ciphertext, d.secrets.tokenEncryption));
  } catch {
    return null;
  }
}

async function loadForUpdate(db: Db, contractId: string) {
  const contract = await db.one<ContractRow>("select * from public.contracts where id = $1 for update", [contractId]);
  if (!contract) throw new AppError("契約が見つかりません", "not_found", 404);
  const party = await db.one<PartyRow>("select * from public.contract_parties where contract_id = $1 order by sign_order limit 1", [
    contractId,
  ]);
  return { contract, party: party! };
}

export async function cancelContract(d: Deps, actor: Actor, contractId: string, reason: string, client?: ClientInfo) {
  const r = reason.trim();
  if (!r) throw new AppError("取消の理由を入力してください");
  await d.db.tx(async (tx) => {
    const { contract, party } = await loadForUpdate(tx, contractId);
    if (contract.status === "signed") throw new AppError("署名済みの契約は取り消せません", "conflict", 409);
    if (contract.status === "canceled") throw new AppError("すでに取り消されています", "conflict", 409);
    await tx.query(
      "update public.contracts set status = 'canceled', canceled_at = now(), cancel_reason = $2 where id = $1",
      [contractId, r],
    );
    const revoked = await tx.query(
      "update public.access_tokens set revoked_at = now(), revoked_reason = 'contract canceled' where contract_party_id = $1 and revoked_at is null returning id",
      [party.id],
    );
    await audit(tx, { contractId, actorType: "admin", actorId: actor.id, eventType: "contract.canceled", payload: { reason: r }, client });
    if (revoked.length) {
      await audit(tx, {
        contractId,
        actorType: "admin",
        actorId: actor.id,
        eventType: "token.revoked",
        payload: { reason: "取消に伴う無効化", count: revoked.length },
        client,
      });
    }
  });
}

export async function revokeTokens(d: Deps, actor: Actor, contractId: string, reason: string, client?: ClientInfo) {
  await d.db.tx(async (tx) => {
    const { party } = await loadForUpdate(tx, contractId);
    const revoked = await tx.query(
      "update public.access_tokens set revoked_at = now(), revoked_reason = $2 where contract_party_id = $1 and revoked_at is null returning id",
      [party.id, reason.trim() || "管理者による無効化"],
    );
    if (!revoked.length) throw new AppError("有効な署名URLはありません");
    await audit(tx, {
      contractId,
      actorType: "admin",
      actorId: actor.id,
      eventType: "token.revoked",
      payload: { reason: reason.trim() || "管理者による無効化", count: revoked.length },
      client,
    });
  });
}

/** 署名URLを再発行する（旧URLは無効化）。期限切れの場合は期限も延長する */
export async function reissueToken(
  d: Deps,
  actor: Actor,
  contractId: string,
  opts: { expiresInDays?: number; sendEmail?: boolean } = {},
  client?: ClientInfo,
) {
  const settings = await getSettings(d.db);
  const days = opts.expiresInDays ?? settings.default_expiry_days;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError("有効期限は1〜365日で指定してください");
  const expiresAt = new Date(d.now().getTime() + days * 86400_000).toISOString();
  const { token, contract, party } = await d.db.tx(async (tx) => {
    const { contract, party } = await loadForUpdate(tx, contractId);
    if (contract.status === "canceled") throw new AppError("取り消された契約のURLは再発行できません", "conflict", 409);
    if (contract.status === "signed") throw new AppError("署名済みの契約のURLは再発行できません", "conflict", 409);
    await tx.query(
      "update public.access_tokens set revoked_at = now(), revoked_reason = 'reissued' where contract_party_id = $1 and revoked_at is null",
      [party.id],
    );
    await tx.query("update public.contracts set expires_at = $2 where id = $1", [contractId, expiresAt]);
    const token = await issueToken(tx, d, party.id, expiresAt, actor.id);
    await audit(tx, { contractId, actorType: "admin", actorId: actor.id, eventType: "token.reissued", payload: { expires_at: expiresAt }, client });
    return { token, contract, party };
  });
  const url = signingUrl(d.appUrl, token);
  if (opts.sendEmail && party.email) {
    const version = await d.db.one<TemplateVersionRow>("select * from public.template_versions where id = $1", [
      contract.template_version_id,
    ]);
    const values = await loadValues(d.db, contractId);
    const msg = inviteMessage(settings, version!, { title: contract.title, signerName: party.name, url, expiresAt, values });
    if (await sendEmail(d, settings, { contractId, partyId: party.id, type: "invite", to: party.email, ...msg })) {
      await audit(d.db, { contractId, actorType: "admin", actorId: actor.id, eventType: "contract.sent", payload: { channel: "email", reissued: true }, client });
    }
  }
  return { url, expiresAt };
}

export async function loadValues(db: Db, contractId: string): Promise<Record<string, string>> {
  const rows = await db.query<{ variable_key: string; value: string }>(
    "select variable_key, value from public.contract_values where contract_id = $1",
    [contractId],
  );
  return Object.fromEntries(rows.map((r) => [r.variable_key, r.value]));
}

/** リマインドを送る（メールアドレスがある場合のみ）。actor が null ならシステムによる自動送信 */
export async function sendReminder(d: Deps, actor: Actor | null, contractId: string, client?: ClientInfo) {
  const settings = await getSettings(d.db);
  const contract = await d.db.one<ContractRow>("select * from public.contracts_view where id = $1", [contractId]);
  if (!contract) throw new AppError("契約が見つかりません", "not_found", 404);
  if (!["sent", "viewed"].includes(contract.effective_status ?? contract.status)) {
    throw new AppError("署名待ちの契約ではありません", "conflict", 409);
  }
  const party = await d.db.one<PartyRow>("select * from public.contract_parties where contract_id = $1 order by sign_order limit 1", [
    contractId,
  ]);
  if (!party?.email) throw new AppError("署名者のメールアドレスが登録されていないため、リマインドを送れません");
  const url = await getSigningUrl(d, contractId);
  if (!url) throw new AppError("有効な署名URLがありません。URLを再発行してください");
  const msg = reminderMessage(settings, { title: contract.title, signerName: party.name, url, expiresAt: contract.expires_at });
  const ok = await sendEmail(d, settings, { contractId, partyId: party.id, type: "reminder", to: party.email, ...msg });
  if (!ok) throw new AppError("リマインドの送信に失敗しました");
  await d.db.query("update public.contract_parties set last_reminded_at = now() where id = $1", [party.id]);
  await audit(d.db, {
    contractId,
    actorType: actor ? "admin" : "system",
    actorId: actor?.id ?? null,
    eventType: "reminder.sent",
    payload: { channel: "email", automatic: !actor },
    client,
  });
}

// ---------------------------------------------------------------------------
// 検索（電子帳簿保存法の検索要件：取引年月日・金額・取引先の範囲/組み合わせ）
// ---------------------------------------------------------------------------
export interface ContractSearch {
  status?: string;
  q?: string;
  counterparty?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
  templateId?: string;
  page?: number;
  pageSize?: number;
}

export interface ContractListItem extends ContractRow {
  signer_name: string | null;
  signer_email: string | null;
  template_name: string;
  version_no: number;
  timestamp_pending: boolean;
}

export async function searchContracts(db: Db, s: ContractSearch) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (s.status) add("c.effective_status = ?", s.status);
  if (s.q?.trim()) add("(c.title ilike ? or p.name ilike ? or p.email ilike ? or c.counterparty_name ilike ?)", `%${s.q.trim()}%`);
  if (s.counterparty?.trim()) add("c.counterparty_name ilike ?", `%${s.counterparty.trim()}%`);
  if (s.dateFrom) add("c.transaction_date >= ?::date", s.dateFrom);
  if (s.dateTo) add("c.transaction_date <= ?::date", s.dateTo);
  if (s.amountMin !== undefined && s.amountMin !== "") add("c.amount >= ?::numeric", s.amountMin);
  if (s.amountMax !== undefined && s.amountMax !== "") add("c.amount <= ?::numeric", s.amountMax);
  if (s.templateId) add("tv.template_id = ?", s.templateId);
  const pageSize = Math.min(200, Math.max(1, s.pageSize ?? 50));
  const page = Math.max(1, s.page ?? 1);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const base = `from public.contracts_view c
    join public.template_versions tv on tv.id = c.template_version_id
    join public.templates t on t.id = tv.template_id
    left join lateral (select * from public.contract_parties p where p.contract_id = c.id order by sign_order limit 1) p on true
    ${whereSql}`;
  const rows = await db.query<ContractListItem>(
    `select c.*, p.name as signer_name, p.email as signer_email, t.name as template_name, tv.version_no,
       (c.status = 'signed' and not exists (
          select 1 from public.document_timestamps ts where ts.contract_id = c.id and ts.target = 'pdf')) as timestamp_pending
     ${base} order by c.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  const total = await db.one<{ n: string }>(`select count(*) as n ${base}`, params);
  return { rows, total: Number(total?.n ?? 0), page, pageSize };
}

export async function dashboardCounts(db: Db) {
  const rows = await db.query<{ status: string; n: string }>(
    "select effective_status as status, count(*) as n from public.contracts_view group by 1",
  );
  const counts: Record<string, number> = { sent: 0, viewed: 0, signed: 0, expired: 0, canceled: 0, draft: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  const pending = await db.one<{ n: string }>(
    `select count(*) as n from public.documents d where not exists
       (select 1 from public.document_timestamps t where t.document_id = d.id and t.target = 'pdf')`,
  );
  return { counts, timestampPending: Number(pending?.n ?? 0) };
}

export async function getContractDetail(db: Db, contractId: string) {
  const contract = await db.one<ContractRow>("select * from public.contracts_view where id = $1", [contractId]);
  if (!contract) throw new AppError("契約が見つかりません", "not_found", 404);
  const [party, version, values, documents, timestamps, events, notifications, token] = await Promise.all([
    db.one<PartyRow>("select * from public.contract_parties where contract_id = $1 order by sign_order limit 1", [contractId]),
    db.one<TemplateVersionRow & { template_name: string }>(
      `select v.*, t.name as template_name from public.template_versions v join public.templates t on t.id = v.template_id where v.id = $1`,
      [contract.template_version_id],
    ),
    db.query<{ variable_key: string; value: string; entered_by: string }>(
      "select variable_key, value, entered_by from public.contract_values where contract_id = $1 order by variable_key",
      [contractId],
    ),
    db.query<DocumentRow>("select * from public.documents where contract_id = $1", [contractId]),
    db.query<TimestampRow>("select * from public.document_timestamps where contract_id = $1 order by created_at", [contractId]),
    db.query<AuditRow>("select * from public.audit_events where contract_id = $1 order by seq", [contractId]),
    db.query<NotificationRow>("select * from public.notifications where contract_id = $1 order by sent_at", [contractId]),
    db.one<AccessTokenRow>(
      `select t.* from public.access_tokens t join public.contract_parties p on p.id = t.contract_party_id
       where p.contract_id = $1 order by t.created_at desc limit 1`,
      [contractId],
    ),
  ]);
  const settings = await getSettings(db);
  const cost =
    notifications.filter((n) => n.status !== "failed").reduce((s, n) => s + Number(n.cost_yen), 0) +
    timestamps.length * Number(settings.cost_timestamp_yen);
  return {
    contract,
    party: party!,
    version: version!,
    values,
    documents,
    timestamps,
    events,
    notifications,
    token: token ? { expires_at: token.expires_at, revoked_at: token.revoked_at, created_at: token.created_at } : null,
    costYen: Math.round(cost * 1000) / 1000,
  };
}

export async function usageCosts(db: Db, month?: string) {
  const settings = await getSettings(db);
  const m = month ?? new Date().toISOString().slice(0, 7);
  const n = await db.query<{ channel: string; count: string; cost: string }>(
    `select channel, count(*) as count, coalesce(sum(cost_yen), 0) as cost from public.notifications
     where status <> 'failed' and to_char(sent_at at time zone 'Asia/Tokyo', 'YYYY-MM') = $1 group by channel`,
    [m],
  );
  const ts = await db.one<{ count: string }>(
    `select count(*) as count from public.document_timestamps where to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM') = $1`,
    [m],
  );
  const contracts = await db.one<{ count: string }>(
    `select count(*) as count from public.contracts where to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM') = $1`,
    [m],
  );
  const items = n.map((r) => ({ label: r.channel === "email" ? "メール" : r.channel, count: Number(r.count), cost: Number(r.cost) }));
  const tsCount = Number(ts?.count ?? 0);
  items.push({ label: "タイムスタンプ", count: tsCount, cost: tsCount * Number(settings.cost_timestamp_yen) });
  const total = items.reduce((s, i) => s + i.cost, 0);
  const contractCount = Number(contracts?.count ?? 0);
  return { month: m, items, total, contractCount, perContract: contractCount ? total / contractCount : 0 };
}
