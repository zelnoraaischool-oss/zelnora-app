import "server-only";
import {
  COURSE_TEMPLATE_NAME,
  courseBody,
  courseConfirmItems,
  courseKeyClauses,
  courseVariables,
  defaultClauses,
} from "../seed/course-contract";
import type { ClientInfo } from "./audit";
import type { Db } from "./db";
import { createTemplate, publishDraft, saveClause } from "./templates";
import type { Actor } from "./types";

/** 既存の受講契約書を初期テンプレートとして登録し、公開する（登録済みなら何もしない） */
export async function seedCourseTemplate(db: Db, actor: Actor, client?: ClientInfo): Promise<{ templateId: string; created: boolean }> {
  const existing = await db.one<{ id: string }>("select id from public.templates where name = $1", [COURSE_TEMPLATE_NAME]);
  if (existing) return { templateId: existing.id, created: false };
  const t = await createTemplate(
    db,
    actor,
    {
      name: COURSE_TEMPLATE_NAME,
      description: "マンツーマン講座の受講契約（初期テンプレート）",
      version: {
        body: courseBody,
        variables: courseVariables,
        confirm_screen_items: courseConfirmItems,
        key_clauses: courseKeyClauses,
        amount_variable_key: "受講料",
        transaction_date_variable_key: "契約日",
        counterparty_variable_key: null,
        email_subject: "【ご確認ください】{{契約名}}",
        email_body: "",
      },
    },
    client,
  );
  await publishDraft(db, actor, t.id, client);
  const clauseCount = await db.one<{ n: string }>("select count(*) as n from public.clauses");
  if (Number(clauseCount?.n ?? 0) === 0) {
    for (const c of defaultClauses) await saveClause(db, actor, c, client);
  }
  return { templateId: t.id, created: true };
}
