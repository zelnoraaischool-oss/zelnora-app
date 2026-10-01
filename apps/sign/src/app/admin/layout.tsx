import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/server/auth";
import { missingConfig } from "@/lib/server/config-check";
import { deps } from "@/lib/server/deps";
import { getSettings } from "@/lib/server/settings";
import { logoutAction } from "../login/actions";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 初期設定が済んでいなければ、ログイン画面で足りない設定を案内する
  if (missingConfig().length) redirect("/login");
  const actor = await requireAdmin();
  const settings = await getSettings(deps().db);
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-5">
          <Link href="/admin" className="block">
            <span className="block text-xs text-slate-500">{settings.organization_name}</span>
            <span className="text-lg font-bold">電子契約</span>
          </Link>
          <Link href="/admin/contracts/new" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white lg:mt-4 lg:block lg:text-center">
            ＋ 新しい契約
          </Link>
        </div>
        <AdminNav role={actor.role} />
        <div className="hidden px-4 py-4 text-xs text-slate-500 lg:absolute lg:bottom-0 lg:block">
          <div className="truncate">{actor.email}</div>
          <div>{actor.role === "owner" ? "オーナー" : "スタッフ"}</div>
          <form action={logoutAction}>
            <button className="mt-2 underline">ログアウト</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
