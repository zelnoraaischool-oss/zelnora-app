"use server";

import { redirect } from "next/navigation";
import { audit, maskEmail } from "@/lib/server/audit";
import { clientInfo, devSignIn, devSignOut, getAuthState, isDevAuth, supabaseServer } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";

export interface FormState {
  error?: string;
  qr?: string;
  secret?: string;
  factorId?: string;
}

const MAX_FAILURES = 10;

async function tooManyFailures(ip: string | null, email: string): Promise<boolean> {
  const r = await deps().db.one<{ n: string }>(
    `select count(*) as n from public.audit_events where event_type = 'admin.login_failed'
     and created_at > now() - interval '15 minutes' and (ip = $1 or payload->>'email' = $2)`,
    [ip, maskEmail(email)],
  );
  return Number(r?.n ?? 0) >= MAX_FAILURES;
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const client = await clientInfo();
  const d = deps();
  if (!email || (!password && !isDevAuth())) return { error: "メールアドレスとパスワードを入力してください" };
  if (await tooManyFailures(client.ip, email)) {
    return { error: "ログインの失敗が続いたため、一時的に制限しています。15分ほど時間をおいてお試しください。" };
  }
  if (isDevAuth()) {
    const admin = await d.db.one<{ id: string }>("select id from public.admins where lower(email) = $1 and disabled_at is null", [email]);
    if (!admin) {
      await audit(d.db, { actorType: "public", eventType: "admin.login_failed", payload: { email: maskEmail(email), driver: "dev" }, client });
      return { error: "管理者として登録されていません" };
    }
    await devSignIn(admin.id);
    await audit(d.db, { actorType: "admin", actorId: admin.id, eventType: "admin.login", payload: { driver: "dev" }, client });
    redirect("/admin");
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await audit(d.db, { actorType: "public", eventType: "admin.login_failed", payload: { email: maskEmail(email), stage: "password" }, client });
    return { error: "メールアドレスまたはパスワードが正しくありません" };
  }
  const admin = await d.db.one<{ id: string }>("select id from public.admins where id = $1 and disabled_at is null", [data.user.id]);
  if (!admin) {
    await sb.auth.signOut();
    await audit(d.db, { actorType: "public", eventType: "admin.login_failed", payload: { email: maskEmail(email), stage: "not_admin" }, client });
    return { error: "このアカウントには管理画面の権限がありません" };
  }
  redirect("/login/mfa");
}

/** 認証アプリ（TOTP）の登録を始める */
export async function startEnrollAction(): Promise<FormState> {
  const state = await getAuthState();
  if (state.kind !== "needs_mfa" || state.enrolled) return { error: "登録を開始できません。ログインし直してください。" };
  const sb = await supabaseServer();
  const factors = await sb.auth.mfa.listFactors();
  for (const f of factors.data?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `sign-${Date.now()}` });
  if (error || !data) return { error: `認証アプリの登録を開始できませんでした：${error?.message ?? ""}` };
  return { qr: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
}

export async function verifyMfaAction(_: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const enrollingFactor = String(form.get("factorId") ?? "");
  const client = await clientInfo();
  const d = deps();
  const state = await getAuthState();
  if (state.kind !== "needs_mfa") redirect(state.kind === "ok" ? "/admin" : "/login");
  if (code.length !== 6) return { error: "6桁のコードを入力してください", factorId: enrollingFactor || undefined };
  const sb = await supabaseServer();
  let factorId = enrollingFactor;
  if (!factorId) {
    const factors = await sb.auth.mfa.listFactors();
    factorId = factors.data?.totp.find((f) => f.status === "verified")?.id ?? "";
  }
  if (!factorId) return { error: "認証アプリが登録されていません" };
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    await audit(d.db, { actorType: "admin", actorId: state.userId, eventType: "admin.login_failed", payload: { stage: "mfa" }, client });
    return { error: "コードが正しくありません。認証アプリの最新のコードを入力してください。", factorId: enrollingFactor || undefined };
  }
  if (enrollingFactor) {
    await d.db.query("update public.admins set mfa_enabled = true where id = $1", [state.userId]);
    await audit(d.db, { actorType: "admin", actorId: state.userId, eventType: "admin.mfa_enrolled", client });
  }
  await audit(d.db, { actorType: "admin", actorId: state.userId, eventType: "admin.login", payload: { aal: "aal2" }, client });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const state = await getAuthState();
  const client = await clientInfo();
  if (state.kind === "ok") {
    await audit(deps().db, { actorType: "admin", actorId: state.admin.id, eventType: "admin.logout", client });
  }
  if (isDevAuth()) await devSignOut();
  else await (await supabaseServer()).auth.signOut();
  redirect("/login");
}
