import type { AuditEntry } from "@zelnora/core";
import { useState } from "react";
import { Card, dateTime, Empty, Input, Loading, PageHeader } from "../components/ui";
import { useApi } from "../lib/api";
import { useSession } from "../lib/session";

export function AuditPage() {
  const s = useSession();
  const [q, setQ] = useState("");
  const { data, loading } = useApi<AuditEntry[]>("audit.list", { limit: 500 });
  const rows = (data ?? []).filter((a) => !q || `${a.action} ${a.user} ${a.entity} ${a.detail}`.includes(q));
  return (
    <>
      <PageHeader title="監査ログ" description="担当の付け替え、顧客の統合、締めの解除、設定の変更などの操作の記録です。" />
      <Card>
        <Input className="mb-3" placeholder="操作・利用者・内容で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>記録はありません</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">日時</th>
                  <th className="px-3 py-2">利用者</th>
                  <th className="px-3 py-2">操作</th>
                  <th className="px-3 py-2">対象</th>
                  <th className="px-3 py-2">内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-1.5 text-xs tabular-nums">{dateTime(a.at)}</td>
                    <td className="px-3 py-1.5 text-xs">{s.userName(a.user)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{a.action}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {a.entity} <span className="text-slate-400">{a.entityId.slice(0, 24)}</span>
                    </td>
                    <td className="max-w-md truncate px-3 py-1.5 text-xs text-slate-600" title={a.detail}>
                      {a.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
