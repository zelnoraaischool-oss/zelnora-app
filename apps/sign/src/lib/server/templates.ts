import "server-only";
import {
  collectTextVariableKeys,
  collectVariableKeys,
  EMPTY_DOC,
  parseConfirmItems,
  parseKeyClauses,
  sanitizeDoc,
} from "../contract/document";
import { parseVariableDefs, SYSTEM_VARIABLES } from "../contract/variables";
import { audit, type ClientInfo } from "./audit";
import type { Db } from "./db";
import { type Actor, AppError, type ClauseRow, type TemplateRow, type TemplateVersionRow } from "./types";

export function requireOwner(actor: Actor): void {
  if (actor.role !== "owner") throw new AppError("この操作はオーナーのみ実行できます", "forbidden", 403);
}

export async function listTemplates(db: Db, opts: { includeArchived?: boolean } = {}) {
  return db.query<
    TemplateRow & { current_version_no: number | null; has_draft: boolean; contract_count: string }
  >(
    `select t.*, v.version_no as current_version_no,
       exists (select 1 from public.template_versions d where d.template_id = t.id and d.published_at is null) as has_draft,
       (select count(*) from public.contracts c join public.template_versions tv on tv.id = c.template_version_id
         where tv.template_id = t.id) as contract_count
     from public.templates t
     left join public.template_versions v on v.id = t.current_version_id
     where ($1 or t.status = 'active')
     order by t.updated_at desc`,
    [opts.includeArchived ?? false],
  );
}

export async function getTemplate(db: Db, id: string) {
  const template = await db.one<TemplateRow>("select * from public.templates where id = $1", [id]);
  if (!template) throw new AppError("テンプレートが見つかりません", "not_found", 404);
  const versions = await db.query<TemplateVersionRow>(
    "select * from public.template_versions where template_id = $1 order by version_no desc",
    [id],
  );
  const draft = versions.find((v) => !v.published_at) ?? null;
  const current = versions.find((v) => v.id === template.current_version_id) ?? null;
  return { template, versions, draft, current };
}

export async function getVersion(db: Db, id: string) {
  const v = await db.one<TemplateVersionRow & { template_name: string }>(
    `select v.*, t.name as template_name from public.template_versions v
     join public.templates t on t.id = v.template_id where v.id = $1`,
    [id],
  );
  if (!v) throw new AppError("テンプレートのバージョンが見つかりません", "not_found", 404);
  return v;
}

export async function createTemplate(
  db: Db,
  actor: Actor,
  input: { name: string; description?: string; version?: Partial<DraftInput> },
  client?: ClientInfo,
) {
  requireOwner(actor);
  const name = input.name.trim();
  if (!name) throw new AppError("テンプレート名を入力してください");
  return db.tx(async (tx) => {
    const t = await tx.one<TemplateRow>(
      "insert into public.templates (name, description, created_by) values ($1, $2, $3) returning *",
      [name, input.description?.trim() ?? "", actor.id],
    );
    const draft = normalizeDraft({ body: EMPTY_DOC, ...input.version });
    await tx.query(
      `insert into public.template_versions (template_id, version_no, body, variables, confirm_screen_items, key_clauses,
         amount_variable_key, transaction_date_variable_key, counterparty_variable_key, email_subject, email_body, created_by)
       values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [t!.id, ...draftParams(draft), actor.id],
    );
    await audit(tx, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "template.created",
      payload: { template_id: t!.id, name },
      client,
    });
    return t!;
  });
}

export interface DraftInput {
  body: unknown;
  variables: unknown;
  confirm_screen_items: unknown;
  key_clauses: unknown;
  amount_variable_key: string | null;
  transaction_date_variable_key: string | null;
  counterparty_variable_key: string | null;
  email_subject: string;
  email_body: string;
}

function normalizeDraft(input: Partial<DraftInput>) {
  const variables = parseVariableDefs(input.variables ?? []);
  const keys = new Set(variables.map((v) => v.key));
  const pick = (k: string | null | undefined) => (k && keys.has(k) ? k : null);
  return {
    body: sanitizeDoc(input.body ?? EMPTY_DOC),
    variables,
    confirm_screen_items: parseConfirmItems(input.confirm_screen_items),
    key_clauses: parseKeyClauses(input.key_clauses),
    amount_variable_key: pick(input.amount_variable_key),
    transaction_date_variable_key: pick(input.transaction_date_variable_key),
    counterparty_variable_key: pick(input.counterparty_variable_key),
    email_subject: (input.email_subject ?? "").trim() || "【ご確認ください】{{契約名}}",
    email_body: (input.email_body ?? "").trim(),
  };
}

function draftParams(d: ReturnType<typeof normalizeDraft>) {
  return [
    JSON.stringify(d.body),
    JSON.stringify(d.variables),
    JSON.stringify(d.confirm_screen_items),
    JSON.stringify(d.key_clauses),
    d.amount_variable_key,
    d.transaction_date_variable_key,
    d.counterparty_variable_key,
    d.email_subject,
    d.email_body,
  ];
}

/** 下書きがなければ、現在の公開版を複製して新しいバージョンの下書きを作る */
export async function ensureDraft(db: Db, actor: Actor, templateId: string, client?: ClientInfo) {
  requireOwner(actor);
  return db.tx(async (tx) => {
    const existing = await tx.one<TemplateVersionRow>(
      "select * from public.template_versions where template_id = $1 and published_at is null",
      [templateId],
    );
    if (existing) return existing;
    const latest = await tx.one<TemplateVersionRow>(
      "select * from public.template_versions where template_id = $1 order by version_no desc limit 1 for update",
      [templateId],
    );
    if (!latest) throw new AppError("テンプレートが見つかりません", "not_found", 404);
    const v = await tx.one<TemplateVersionRow>(
      `insert into public.template_versions (template_id, version_no, body, variables, confirm_screen_items, key_clauses,
         amount_variable_key, transaction_date_variable_key, counterparty_variable_key, email_subject, email_body, require_sms, created_by)
       select template_id, version_no + 1, body, variables, confirm_screen_items, key_clauses, amount_variable_key,
         transaction_date_variable_key, counterparty_variable_key, email_subject, email_body, require_sms, $2
       from public.template_versions where id = $1 returning *`,
      [latest.id, actor.id],
    );
    await audit(tx, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "template.draft_saved",
      payload: { template_id: templateId, version_no: v!.version_no, from_version: latest.version_no },
      client,
    });
    return v!;
  });
}

export async function saveDraft(
  db: Db,
  actor: Actor,
  templateId: string,
  input: Partial<DraftInput> & { name?: string; description?: string },
  client?: ClientInfo,
) {
  requireOwner(actor);
  const draft = await ensureDraft(db, actor, templateId, client);
  const d = normalizeDraft(input);
  return db.tx(async (tx) => {
    const v = await tx.one<TemplateVersionRow>(
      `update public.template_versions set body = $2, variables = $3, confirm_screen_items = $4, key_clauses = $5,
         amount_variable_key = $6, transaction_date_variable_key = $7, counterparty_variable_key = $8,
         email_subject = $9, email_body = $10
       where id = $1 and published_at is null returning *`,
      [draft.id, ...draftParams(d)],
    );
    if (!v) throw new AppError("下書きを保存できませんでした。画面を再読み込みしてください", "conflict", 409);
    if (input.name !== undefined || input.description !== undefined) {
      const name = input.name?.trim();
      if (name === "") throw new AppError("テンプレート名を入力してください");
      await tx.query(
        "update public.templates set name = coalesce($2, name), description = coalesce($3, description) where id = $1",
        [templateId, name ?? null, input.description?.trim() ?? null],
      );
    } else {
      await tx.query("update public.templates set updated_at = now() where id = $1", [templateId]);
    }
    await audit(tx, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "template.draft_saved",
      payload: { template_id: templateId, version_no: v.version_no },
      client,
    });
    return v;
  });
}

/** 公開前のチェック。問題点の一覧（日本語）を返す */
export function validateForPublish(v: Pick<TemplateVersionRow, "body" | "variables" | "confirm_screen_items" | "email_subject" | "email_body">): string[] {
  const problems: string[] = [];
  const defined = new Set([...v.variables.map((x) => x.key), ...SYSTEM_VARIABLES]);
  const used = new Set([
    ...collectVariableKeys(v.body),
    ...Object.values(v.confirm_screen_items).flatMap((t) => collectTextVariableKeys(t ?? "")),
  ]);
  for (const k of used) if (!defined.has(k)) problems.push(`本文で使われている変数「${k}」が定義されていません`);
  const hasText = JSON.stringify(v.body).includes('"text"');
  if (!hasText) problems.push("本文が空です");
  for (const def of v.variables) {
    if (def.type === "select" && !(def.options && def.options.length)) problems.push(`変数「${def.key}」の選択肢を設定してください`);
  }
  return problems;
}

export async function publishDraft(db: Db, actor: Actor, templateId: string, client?: ClientInfo) {
  requireOwner(actor);
  return db.tx(async (tx) => {
    const draft = await tx.one<TemplateVersionRow>(
      "select * from public.template_versions where template_id = $1 and published_at is null for update",
      [templateId],
    );
    if (!draft) throw new AppError("公開する下書きがありません");
    const problems = validateForPublish(draft);
    if (problems.length) throw new AppError(problems.join("\n"), "invalid_template");
    const v = await tx.one<TemplateVersionRow>(
      "update public.template_versions set published_at = now() where id = $1 returning *",
      [draft.id],
    );
    await tx.query("update public.templates set current_version_id = $2, status = 'active' where id = $1", [
      templateId,
      draft.id,
    ]);
    await audit(tx, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "template.published",
      payload: { template_id: templateId, version_id: v!.id, version_no: v!.version_no, body_hash: v!.body_hash },
      client,
    });
    return v!;
  });
}

export async function duplicateTemplate(db: Db, actor: Actor, templateId: string, client?: ClientInfo) {
  requireOwner(actor);
  const { template, draft, current } = await getTemplate(db, templateId);
  const source = current ?? draft;
  if (!source) throw new AppError("複製元の内容がありません");
  const copy = await createTemplate(
    db,
    actor,
    { name: `${template.name}（コピー）`, description: template.description, version: source },
    client,
  );
  await audit(db, {
    actorType: "admin",
    actorId: actor.id,
    eventType: "template.duplicated",
    payload: { from_template_id: templateId, template_id: copy.id },
    client,
  });
  return copy;
}

export async function setTemplateArchived(db: Db, actor: Actor, templateId: string, archived: boolean, client?: ClientInfo) {
  requireOwner(actor);
  await db.query("update public.templates set status = $2 where id = $1", [templateId, archived ? "archived" : "active"]);
  await audit(db, {
    actorType: "admin",
    actorId: actor.id,
    eventType: archived ? "template.archived" : "template.restored",
    payload: { template_id: templateId },
    client,
  });
}

// ---------------------------------------------------------------------------
// 条項ライブラリ
// ---------------------------------------------------------------------------
export async function listClauses(db: Db) {
  return db.query<ClauseRow>("select * from public.clauses order by category, name");
}

export async function saveClause(
  db: Db,
  actor: Actor,
  input: { id?: string; name: string; category?: string; body: unknown },
  client?: ClientInfo,
) {
  requireOwner(actor);
  const name = input.name.trim();
  if (!name) throw new AppError("条項名を入力してください");
  const body = sanitizeDoc(input.body);
  const row = input.id
    ? await db.one<ClauseRow>(
        "update public.clauses set name = $2, category = $3, body = $4 where id = $1 returning *",
        [input.id, name, input.category?.trim() ?? "", JSON.stringify(body)],
      )
    : await db.one<ClauseRow>("insert into public.clauses (name, category, body) values ($1, $2, $3) returning *", [
        name,
        input.category?.trim() ?? "",
        JSON.stringify(body),
      ]);
  if (!row) throw new AppError("条項が見つかりません", "not_found", 404);
  await audit(db, {
    actorType: "admin",
    actorId: actor.id,
    eventType: input.id ? "clause.updated" : "clause.created",
    payload: { clause_id: row.id, name },
    client,
  });
  return row;
}

export async function deleteClause(db: Db, actor: Actor, id: string, client?: ClientInfo) {
  requireOwner(actor);
  await db.query("delete from public.clauses where id = $1", [id]);
  await audit(db, { actorType: "admin", actorId: actor.id, eventType: "clause.deleted", payload: { clause_id: id }, client });
}
