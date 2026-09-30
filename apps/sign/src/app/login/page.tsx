import { redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { getAuthState, isDevAuth } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン" };

export default async function LoginPage() {
  const state = await getAuthState();
  if (state.kind === "ok") redirect("/admin");
  if (state.kind === "needs_mfa") redirect("/login/mfa");
  const dev = isDevAuth();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">電子契約 管理画面</h1>
      <p className="mb-6 text-sm text-slate-600">ログイン後、認証アプリのコード（多要素認証）が必要です。</p>
      {dev && (
        <div className="mb-4">
          <Alert tone="warning">開発用ログイン（AUTH_DRIVER=dev）が有効です。本番では使用できません。</Alert>
        </div>
      )}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <LoginForm devMode={dev} />
      </div>
    </main>
  );
}
