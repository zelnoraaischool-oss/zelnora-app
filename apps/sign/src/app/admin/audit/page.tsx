import Link from "next/link";
import { Badge, Card, Input, PageHeader } from "@/components/ui";
import { auditLabel } from "@/lib/audit-labels";
import { formatJst } from "@/lib/format";
import { deps } from "@/lib/server/deps";
import type { AuditRow } from "@/lib/server/types";
import { VerifyChain } from "./verify";

export const metadata = { title: "監査ログ" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string; before?: string }> }) {
  const sp = await searchParams;
  const d = deps();
  const params: unknown[] = [];
  const where: string[] = [];
  if (sp.type) {
    params.push(`${sp.type}%`);
    where.push(`a.event_type like $${params.length}`);
  }
  if (sp.before && /^\d+$/.test(sp.before)) {
    params.push(sp.before);
    where.push(`a.seq < $${params.length}`);
  }
  const rows = await d.db.query<AuditRow & { actor_email: string | null; contract_title: string | null }>(
    `select a.*, ad.email as actor_email, c.title as contract_title from public.audit_events a
     left join public.admins ad on a.actor_type = 'admin' and ad.id::text = a.actor_id
     left join public.contracts c on c.id = a.contract_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by a.seq desc limit 100`,
    params,
  );
  const last = rows[rows.length - 1];
  return (
    <>
      <PageHeader title="監査ログ" description="すべての操作を追記専用で記録し、ハッシュチェーンで連結しています（日時は日本時間）。" />
      <VerifyChain />
      <Card className="mt-5" title="記録">
        <form className="mb-3 flex gap-2" action="/admin/audit">
          <Input name="type" defaultValue={sp.type} placeholder="イベントの種類で絞り込み（例：admin、contract.signed）" />
        </form>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">日時</th>
                <th className="px-2 py-2">イベント</th>
                <th className="px-2 py-2">実行者</th>
                <th className="px-2 py-2">契約</th>
                <th className="px-2 py-2">IP</th>
                <th className="px-2 py-2">ハッシュ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5 font-mono text-xs text-slate-500">{r.seq}</td>
                  <td className="px-2 py-1.5 font-mono text-xs tabular-nums">{formatJst(r.created_at, { seconds: true })}</td>
                  <td className="px-2 py-1.5">
                    {auditLabel(r.event_type)}
                    <div className="font-mono text-[11px] text-slate-400">{r.event_type}</div>
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    <Badge>{r.actor_type}</Badge> {r.actor_email}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {r.contract_id && (
                      <Link className="text-brand-700 hover:underline" href={`/admin/contracts/${r.contract_id}`}>
                        {r.contract_title}
                      </Link>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{r.ip}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400" title={r.hash}>
                    {r.hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 100 && last && (
          <div className="mt-3 text-right text-sm">
            <Link className="text-brand-700" href={`/admin/audit?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), before: String(last.seq) })}`}>
              さらに古い記録 →
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
