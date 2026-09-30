import { can, type TodoItem } from "@zelnora/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CompleteActionDialog, PostponeButtons } from "../components/next-action";
import { ProductPicker } from "../components/pickers";
import { Badge, Button, Card, Empty, Loading, PageHeader, pct, Select, yen } from "../components/ui";
import { useApi } from "../lib/api";
import { useSession } from "../lib/session";

type Dash = ReturnType<typeof import("@zelnora/core").dashboard>;

function Stat({ label, value, sub, to }: { label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string }) {
  const inner = (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:ring-brand-600">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function HomePage() {
  const s = useSession();
  const [period, setPeriod] = useState<"this_month" | "last_month" | "quarter">("this_month");
  const [productId, setProductId] = useState("");
  const { data, loading, reload } = useApi<Dash>("dashboard", { period, productId: productId || undefined });
  const [completing, setCompleting] = useState<TodoItem | null>(null);
  const role = s.user.role;
  const isManager = ["owner", "admin", "manager"].includes(role);
  return (
    <>
      <PageHeader
        title={`こんにちは、${s.user.name}さん`}
        actions={
          <>
            <Select aria-label="期間" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="this_month">今月</option>
              <option value="last_month">先月</option>
              <option value="quarter">四半期</option>
            </Select>
            <ProductPicker value={productId} onChange={setProductId} allowAll />
          </>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-5">
          <Card title={`今日やること（${data.todo.length}件）`}>
            {data.todo.length === 0 ? (
              <Empty>期限が今日までのアクションはありません</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.todo.map((t) => (
                  <li key={`${t.kind}-${t.refId}`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 shrink-0 text-xs tabular-nums">{t.overdue ? <Badge tone="red">期限切れ {t.due.slice(5)}</Badge> : <Badge tone="amber">今日</Badge>}</span>
                    <span className="min-w-0 flex-1">
                      <Link to={`/customers/${t.customerId}`} className="font-semibold text-brand-700 hover:underline">
                        {t.customerName}
                      </Link>
                      <span className="ml-2 text-sm">{t.title}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {t.kind === "deal" ? "営業" : s.labels(t.productId).delivery}・{s.userName(t.owner)}
                      </span>
                    </span>
                    {t.kind === "deal" ? (
                      <>
                        <Button size="sm" onClick={() => setCompleting(t)}>
                          完了
                        </Button>
                        <PostponeButtons refs={{ dealId: t.refId }} onDone={reload} />
                      </>
                    ) : (
                      <>
                        <Link to={`/delivery?product=${t.productId}&open=${t.refId}`} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-600">
                          記録する
                        </Link>
                        <PostponeButtons refs={{ deliveryId: t.refId }} onDone={reload} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(role === "sales" || isManager) && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="成約数" value={`${data.sales.wonCount}件`} sub={<>前期比 {pct(data.sales.wonCountChange)}</>} to="/sales" />
              <Stat label="成約金額" value={yen(data.sales.wonAmount)} sub={<>前期比 {pct(data.sales.wonAmountChange)}</>} to="/revenue" />
              <Stat label="進行中の見込み" value={yen(data.sales.forecast.pipeline)} sub={`${data.sales.forecast.deals}件`} to="/sales" />
              <Stat label="確度を掛けた見込み" value={yen(data.sales.forecast.expected)} sub={`${data.sales.forecast.month} 以降`} />
            </div>
          )}
          {(role === "delivery" || isManager) && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={`担当中の${s.labels().delivery}`} value={`${data.delivery.activeCount}件`} to="/delivery" />
              <Stat label="今週の予定" value={`${data.delivery.thisWeek}件`} to="/delivery" />
              <Stat label="遅れ" value={<span className={data.delivery.overdue ? "text-rose-700" : ""}>{data.delivery.overdue}件</span>} to="/delivery" />
              <Stat label="修了が近い（14日以内）" value={`${data.delivery.endingSoon.length}件`} />
            </div>
          )}
          {(role === "accounting" || role === "owner" || role === "admin") && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={`今月の売上（${data.accounting.month}）`} value={yen(data.accounting.total)} sub={<>前月比 {pct(data.accounting.totalChange)}</>} to="/revenue" />
              <Stat label="うち確定" value={yen(data.accounting.confirmed)} sub={`予定 ${yen(data.accounting.planned)}`} />
              <Stat label="入金の遅れ" value={<span className={data.accounting.unpaidCount ? "text-rose-700" : ""}>{data.accounting.unpaidCount}件</span>} sub={yen(data.accounting.unpaidAmount)} to="/revenue" />
              <Stat
                label="月次締め"
                value={
                  <span className="flex flex-wrap gap-1 text-xs">
                    {data.accounting.closing.map((c) => (
                      <Badge key={c.month} tone={c.closed ? "green" : "amber"}>
                        {c.month} {c.closed ? "済" : "未"}
                      </Badge>
                    ))}
                  </span>
                }
                to="/revenue"
              />
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            {(role === "sales" || isManager) && (
              <Card title="段階ごとの件数">
                {data.sales.stageCounts.map((p) => (
                  <div key={p.productId} className="mb-3">
                    <div className="mb-1 text-xs font-semibold text-slate-500">{p.productName}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.stages.map((st) => (
                        <span key={st.stageId} className="rounded-lg bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                          {st.name} <b className="tabular-nums">{st.count}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {(role === "sales" || isManager) && (
              <Card title="同じ段階に長く止まっている商談">
                {data.sales.staleDeals.length === 0 ? (
                  <Empty>ありません</Empty>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {data.sales.staleDeals.map((x) => (
                      <li key={x.deal.id} className="flex justify-between py-1.5">
                        <Link className="text-brand-700 hover:underline" to={`/customers/${x.deal.customerId}`}>
                          {x.customerName}
                        </Link>
                        <span className="text-xs text-slate-500">
                          {x.stageName}・{x.days}日・{s.userName(x.deal.owner)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {(role === "delivery" || isManager) && (
              <Card title={`修了が近い${s.labels().delivery}`}>
                {data.delivery.endingSoon.length === 0 ? (
                  <Empty>ありません</Empty>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {data.delivery.endingSoon.map((x) => (
                      <li key={x.delivery.id} className="flex justify-between py-1.5">
                        <Link className="text-brand-700 hover:underline" to={`/customers/${x.delivery.customerId}`}>
                          {x.customerName}
                        </Link>
                        <span className="text-xs text-slate-500">終了日 {x.delivery.endDate}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {isManager && (
              <Card title="担当者別の負荷と遅れ">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-1">担当者</th>
                      <th className="py-1 text-right">進行中の商談</th>
                      <th className="py-1 text-right">担当中の提供</th>
                      <th className="py-1 text-right">期限切れ</th>
                      <th className="py-1 text-right">進捗の遅れ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.manager.load.map((l) => (
                      <tr key={l.owner} className="border-t border-slate-100">
                        <td className="py-1">{s.userName(l.owner)}</td>
                        <td className="py-1 text-right tabular-nums">{l.openDeals}</td>
                        <td className="py-1 text-right tabular-nums">{l.activeDeliveries}</td>
                        <td className={`py-1 text-right tabular-nums ${l.overdueActions ? "font-bold text-rose-700" : ""}`}>{l.overdueActions}</td>
                        <td className={`py-1 text-right tabular-nums ${l.overdueItems ? "font-bold text-rose-700" : ""}`}>{l.overdueItems}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {isManager && can(s.user, "revenues.summary") && (
              <Card title="商材別の今月の売上">
                <ul className="space-y-1 text-sm">
                  {data.manager.revenueByProduct.map((r) => (
                    <li key={r.productId} className="flex justify-between">
                      <span>{r.name}</span>
                      <span className="tabular-nums">
                        {yen(r.amount)} <span className="text-xs text-slate-400">（先月 {yen(r.prev)}）</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      ) : null}
      {completing && (
        <CompleteActionDialog
          dealId={completing.refId}
          current={completing.title}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
