import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signPayload, verifyPayload } from "../crypto";
import { deps } from "./deps";
import type { Actor, AdminRow } from "./types";
import type { ClientInfo } from "./audit";

export function isDevAuth(): boolean {
  if (process.env.AUTH_DRIVER !== "dev") return false;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_DRIVER=dev は本番環境では使用できません");
  }
  return true;
}

export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Componentからは書き込めない（proxyで更新済み）
        }
      },
    },
  });
}

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "not_admin"; email: string | null }
  | { kind: "needs_mfa"; userId: string; enrolled: boolean }
  | { kind: "ok"; admin: AdminRow };

const DEV_COOKIE = "dev_admin";

async function loadAdmin(id: string): Promise<AdminRow | null> {
  return deps().db.one<AdminRow>("select * from public.admins where id = $1 and disabled_at is null", [id]);
}

export async function getAuthState(): Promise<AuthState> {
  if (isDevAuth()) {
    const store = await cookies();
    const p = verifyPayload<{ id: string; exp: number }>(store.get(DEV_COOKIE)?.value, deps().secrets.session);
    if (!p || p.exp < Date.now()) return { kind: "anonymous" };
    const admin = await loadAdmin(p.id);
    return admin ? { kind: "ok", admin } : { kind: "anonymous" };
  }
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { kind: "anonymous" };
  const admin = await loadAdmin(claims.sub);
  if (!admin) return { kind: "not_admin", email: (claims.email as string | undefined) ?? null };
  if (claims.aal !== "aal2") {
    const factors = await sb.auth.mfa.listFactors();
    const enrolled = (factors.data?.totp ?? []).some((f) => f.status === "verified");
    return { kind: "needs_mfa", userId: claims.sub, enrolled };
  }
  return { kind: "ok", admin };
}

/** 管理画面・Server Actionの入口で必ず呼ぶ。未ログイン・MFA未完了ならリダイレクトする */
export async function requireAdmin(opts: { owner?: boolean } = {}): Promise<Actor> {
  const s = await getAuthState();
  if (s.kind === "anonymous" || s.kind === "not_admin") redirect("/login");
  if (s.kind === "needs_mfa") redirect("/login/mfa");
  if (opts.owner && s.admin.role !== "owner") redirect("/admin?error=forbidden");
  return { id: s.admin.id, email: s.admin.email, role: s.admin.role };
}

/** API（Route Handler）用：リダイレクトせず null を返す */
export async function currentAdmin(): Promise<Actor | null> {
  const s = await getAuthState();
  if (s.kind !== "ok") return null;
  return { id: s.admin.id, email: s.admin.email, role: s.admin.role };
}

export async function devSignIn(adminId: string): Promise<void> {
  if (!isDevAuth()) throw new Error("dev auth disabled");
  const store = await cookies();
  store.set(DEV_COOKIE, signPayload({ id: adminId, exp: Date.now() + 12 * 3600_000 }, deps().secrets.session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function devSignOut(): Promise<void> {
  const store = await cookies();
  store.delete(DEV_COOKIE);
}

/** リクエスト元のIPアドレスとユーザーエージェント */
export async function clientInfo(): Promise<ClientInfo> {
  const h = await headers();
  return clientInfoFromHeaders(h);
}

export function clientInfoFromHeaders(h: Headers): ClientInfo {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}
