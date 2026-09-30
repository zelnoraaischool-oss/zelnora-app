import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/server/auth";
import { logoutAction } from "../actions";
import { MfaForm } from "./mfa-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "多要素認証" };

export default async function MfaPage() {
  const state = await getAuthState();
  if (state.kind === "ok") redirect("/admin");
  if (state.kind !== "needs_mfa") redirect("/login");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">多要素認証</h1>
      <p className="mb-6 text-sm text-slate-600">
        {state.enrolled ? "認証アプリに表示されている6桁のコードを入力してください。" : "初回のみ、認証アプリの登録を行います。"}
      </p>
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <MfaForm enrolled={state.enrolled} />
      </div>
      <form action={logoutAction} className="mt-4 text-center">
        <button className="text-sm text-slate-500 underline">別のアカウントでログイン</button>
      </form>
    </main>
  );
}
