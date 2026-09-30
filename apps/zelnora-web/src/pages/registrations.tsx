import type { Registration } from "@zelnora/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, dateTime, Empty, Input, Loading, PageHeader } from "../components/ui";
import { call, useApi } from "../lib/api";
import { useSession } from "../lib/session";

type Row = Registration & { customerName: string };
const LABEL: Record<string, string> = { pending_merge: "統合の確認待ち", pending_no_deal: "商談なし", pending_before_contract: "契約前の登録", failed: "失敗", ok: "取り込み済み" };

/** 登録フォームの確認待ち（5.2, 5.4） */
export function RegistrationsPage() {
  const s = useSession();
  const { data, loading, reload } = useApi<Row[]>("registrations.list", { status: "pending" });
  const [target, setTarget] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <>
      <PageHeader title={`${s.labels().registration}の確認`} description="自動で取り込めなかったフォームの回答です。統合先の顧客を指定するか、契約の締結後に取り込み直してください。" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>確認待ちはありません</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === "pending_no_deal" ? "blue" : "amber"}>{LABEL[r.status]}</Badge>
                  <span className="text-xs text-slate-500">{dateTime(r.receivedAt)}</span>
                  <span className="text-sm">{s.product(r.productId)?.name}・{s.settings.plans.find((p) => p.id === r.planId)?.name}</span>
                  {r.customerId && (
                    <Link to={`/customers/${r.customerId}`} className="text-sm text-brand-700 hover:underline">
                      {r.customerName}
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600">{r.message}</p>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-slate-500">回答を見る</summary>
                  <dl className="mt-1 grid grid-cols-[10rem_1fr] gap-1">
                    {Object.entries(r.answers).map(([q, a]) => (
                      <div key={q} className="contents">
                        <dt className="text-slate-500">{r.questions[q] ?? q}</dt>
                        <dd>{a}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {r.status !== "pending_no_deal" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input className="w-72 py-1" placeholder="統合先の顧客ID（空欄なら同じ判定で再実行）" value={target[r.id] ?? ""} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })} />
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await call<{ status: string; message: string }>("registrations.resolve", { id: r.id, customerId: target[r.id] || undefined });
                          setMsg({ tone: "success", text: `取り込み直しました：${LABEL[res.status] ?? res.status}（${res.message}）` });
                          await reload();
                        } catch (e) {
                          setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                        }
                      }}
                    >
                      取り込み直す
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
