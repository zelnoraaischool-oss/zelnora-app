"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/server/audit";
import { clientInfo, isDevAuth, requireAdmin } from "@/lib/server/auth";
import { upsertContact, type ContactInput } from "@/lib/server/contacts";
import {
  cancelContract,
  createContract,
  type CreateContractInput,
  getSigningUrl,
  reissueToken,
  revokeTokens,
  sendReminder,
} from "@/lib/server/contracts";
import { deps } from "@/lib/server/deps";
import { updateSettings } from "@/lib/server/settings";
import {
  createTemplate,
  deleteClause,
  type DraftInput,
  duplicateTemplate,
  ensureDraft,
  publishDraft,
  saveClause,
  saveDraft,
  setTemplateArchived,
} from "@/lib/server/templates";
import { AppError, type SettingsRow } from "@/lib/server/types";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    // redirect() などNext.jsの制御用例外はそのまま投げる
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "処理中にエラーが発生しました。時間をおいて再度お試しください。" };
  }
}

// ---------------------------------------------------------------------------
// 契約
// ---------------------------------------------------------------------------
export async function createContractAction(input: CreateContractInput) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    const r = await createContract(deps(), actor, input, client);
    revalidatePath("/admin");
    return r;
  });
}

export async function getSigningUrlAction(contractId: string) {
  await requireAdmin();
  return run(async () => {
    const url = await getSigningUrl(deps(), contractId);
    if (!url) throw new AppError("有効な署名URLがありません。再発行してください。");
    return { url };
  });
}

export async function cancelContractAction(contractId: string, reason: string) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    await cancelContract(deps(), actor, contractId, reason, client);
    revalidatePath(`/admin/contracts/${contractId}`);
    return {};
  });
}

export async function revokeTokenAction(contractId: string, reason: string) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    await revokeTokens(deps(), actor, contractId, reason, client);
    revalidatePath(`/admin/contracts/${contractId}`);
    return {};
  });
}

export async function reissueTokenAction(contractId: string, expiresInDays: number, sendEmail: boolean) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    const r = await reissueToken(deps(), actor, contractId, { expiresInDays, sendEmail }, client);
    revalidatePath(`/admin/contracts/${contractId}`);
    return r;
  });
}

export async function remindAction(contractId: string) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    await sendReminder(deps(), actor, contractId, client);
    revalidatePath(`/admin/contracts/${contractId}`);
    return {};
  });
}

// ---------------------------------------------------------------------------
// テンプレート・条項
// ---------------------------------------------------------------------------
export async function createTemplateAction(form: FormData) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  const t = await createTemplate(deps().db, actor, { name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") }, client).catch(
    (e: unknown) => {
      if (e instanceof AppError) redirect(`/admin/templates?error=${encodeURIComponent(e.message)}`);
      throw e;
    },
  );
  redirect(`/admin/templates/${t.id}`);
}

export async function saveDraftAction(templateId: string, input: Partial<DraftInput> & { name?: string; description?: string }) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    const v = await saveDraft(deps().db, actor, templateId, input, client);
    return { versionId: v.id, versionNo: v.version_no, savedAt: new Date().toISOString() };
  });
}

export async function startNewVersionAction(templateId: string) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  await ensureDraft(deps().db, actor, templateId, client);
  revalidatePath(`/admin/templates/${templateId}`);
}

export async function publishAction(templateId: string) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    const v = await publishDraft(deps().db, actor, templateId, client);
    revalidatePath(`/admin/templates/${templateId}`);
    return { versionNo: v.version_no, bodyHash: v.body_hash };
  });
}

export async function duplicateTemplateAction(templateId: string) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  const t = await duplicateTemplate(deps().db, actor, templateId, client);
  redirect(`/admin/templates/${t.id}`);
}

export async function archiveTemplateAction(templateId: string, archived: boolean) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  await setTemplateArchived(deps().db, actor, templateId, archived, client);
  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}

export async function saveClauseAction(input: { id?: string; name: string; category?: string; body: unknown }) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    const c = await saveClause(deps().db, actor, input, client);
    revalidatePath("/admin/clauses");
    return { id: c.id };
  });
}

export async function deleteClauseAction(id: string) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    await deleteClause(deps().db, actor, id, client);
    revalidatePath("/admin/clauses");
    return {};
  });
}

// ---------------------------------------------------------------------------
// 連絡先
// ---------------------------------------------------------------------------
export async function saveContactAction(input: ContactInput & { id?: string }) {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    const c = await upsertContact(deps().db, actor, input, client);
    revalidatePath("/admin/contacts");
    return { id: c.id };
  });
}

export async function searchContactsAction(q: string) {
  await requireAdmin();
  const { searchContacts } = await import("@/lib/server/contacts");
  return searchContacts(deps().db, q, 10);
}

// ---------------------------------------------------------------------------
// 設定・管理者・監査
// ---------------------------------------------------------------------------
export async function updateSettingsAction(input: Partial<Record<keyof SettingsRow, unknown>>) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    await updateSettings(deps().db, actor, input, client);
    revalidatePath("/admin/settings");
    return {};
  });
}

export async function inviteAdminAction(input: { email: string; role: "owner" | "staff"; displayName?: string }) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("メールアドレスの形式が正しくありません");
    if (!["owner", "staff"].includes(input.role)) throw new AppError("ロールが正しくありません");
    const d = deps();
    let userId: string;
    if (isDevAuth()) {
      const existing = await d.db.one<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
      userId = existing?.id ?? crypto.randomUUID();
      if (!existing) await d.db.query("insert into auth.users (id, email) values ($1, $2)", [userId, email]);
    } else {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${d.appUrl}/login` });
      if (error || !data.user) throw new AppError(`招待メールを送れませんでした：${error?.message ?? ""}`);
      userId = data.user.id;
    }
    await d.db.query(
      `insert into public.admins (id, email, display_name, role) values ($1, $2, $3, $4)
       on conflict (id) do update set role = excluded.role, display_name = excluded.display_name, disabled_at = null`,
      [userId, email, input.displayName?.trim() || null, input.role],
    );
    await audit(d.db, { actorType: "admin", actorId: actor.id, eventType: "admin.invited", payload: { email, role: input.role }, client });
    revalidatePath("/admin/settings");
    return {};
  });
}

export async function updateAdminAction(id: string, patch: { role?: "owner" | "staff"; disabled?: boolean }) {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  return run(async () => {
    if (id === actor.id) throw new AppError("自分自身のロールや状態は変更できません");
    const d = deps();
    if (patch.role) await d.db.query("update public.admins set role = $2 where id = $1", [id, patch.role]);
    if (patch.disabled !== undefined) {
      await d.db.query("update public.admins set disabled_at = $2 where id = $1", [id, patch.disabled ? new Date().toISOString() : null]);
    }
    await audit(d.db, { actorType: "admin", actorId: actor.id, eventType: "admin.updated", payload: { admin_id: id, ...patch }, client });
    revalidatePath("/admin/settings");
    return {};
  });
}

export async function verifyAuditChainAction() {
  const actor = await requireAdmin();
  const client = await clientInfo();
  return run(async () => {
    const d = deps();
    const r = await d.db.one<{ ok: boolean; checked: string; broken_seq: string | null; reason: string | null; last_hash: string | null }>(
      "select * from public.verify_audit_chain()",
    );
    await audit(d.db, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "audit.verified",
      payload: { ok: r!.ok, checked: Number(r!.checked), broken_seq: r!.broken_seq, last_hash: r!.last_hash },
      client,
    });
    return { result: { ok: r!.ok, checked: Number(r!.checked), brokenSeq: r!.broken_seq, reason: r!.reason, lastHash: r!.last_hash } };
  });
}

export async function seedCourseTemplateAction() {
  const actor = await requireAdmin({ owner: true });
  const client = await clientInfo();
  const { seedCourseTemplate } = await import("@/lib/server/seed");
  const r = await seedCourseTemplate(deps().db, actor, client);
  redirect(`/admin/templates/${r.templateId}`);
}
