import { Card, PageHeader } from "@/components/ui";
import { formatJst } from "@/lib/format";
import { requireAdmin } from "@/lib/server/auth";
import { usageCosts } from "@/lib/server/contracts";
import { deps } from "@/lib/server/deps";
import { getSettings } from "@/lib/server/settings";
import type { AdminRow } from "@/lib/server/types";
import { logoutAction } from "../../login/actions";
import { AdminsManager, SettingsForm } from "./forms";

export const metadata = { title: "設定" };

export default async function SettingsPage() {
  const actor = await requireAdmin();
  const d = deps();
  const [settings, admins, costs] = await Promise.all([
    getSettings(d.db),
    d.db.query<AdminRow>("select * from public.admins order by created_at"),
    usageCosts(d.db),
  ]);
  const isOwner = actor.role === "owner";
  return (
    <>
      <PageHeader
        title="設定"
        actions={
          <form action={logoutAction}>
            <button className="text-sm text-slate-600 underline">ログアウト（{actor.email}）</button>
          </form>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <SettingsForm settings={settings} editable={isOwner} />
        <div className="space-y-5">
          <AdminsManager
            admins={admins.map((a) => ({ id: a.id, email: a.email, role: a.role, mfa: a.mfa_enabled, disabled: !!a.disabled_at, created: formatJst(a.created_at) }))}
            me={actor.id}
            editable={isOwner}
          />
          <Card title={`従量費用（${costs.month}）`}>
            <ul className="space-y-1 text-sm">
              {costs.items.map((i) => (
                <li key={i.label} className="flex justify-between">
                  <span>{i.label}</span>
                  <span>
                    {i.count}件 / {i.cost.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円
                  </span>
                </li>
              ))}
              <li className="flex justify-between border-t border-slate-100 pt-1 font-semibold">
                <span>合計（契約1件あたり）</span>
                <span>
                  {costs.total.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円（{costs.perContract.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円）
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
