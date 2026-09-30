import { can, type Closing, REVENUE_RULE_LABELS, type Revenue } from "@zelnora/core";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ProductPicker } from "../components/pickers";
import { Alert, Badge, Button, Card, downloadText, Empty, Field, Input, Loading, Modal, PageHeader, pct, Select, Tabs, yen } from "../components/ui";
import { call, useApi } from "../lib/api";
import { useSession } from "../lib/session";

type Row = Revenue & { customerName: string; planName: string; productName: string; overdue: boolean; closed: boolean };
type Summary = ReturnType<typeof import("@zelnora/core").revenueSummary>;

const thisMonth = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
const shiftMonth = (m: string, n: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y!, mm! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export function RevenuePage() {
  const s = useSession();
  const [sp] = useSearchParams();
  const canLedger = can(s.user, "revenues.view");
  const [tab, setTab] = useState<"ledger" | "summary" | "closing" | "performance">(canLedger ? "ledger" : "summary");
  const tabs = [
    ...(canLedger ? [{ id: "ledger" as const, label: "売上台帳" }] : []),
    { id: "summary" as const, label: "月次集計" },
    ...(can(s.user, "months.close") ? [{ id: "closing" as const, label: "月次締め" }] : []),
    { id: "performance" as const, label: "担当者別の成績" },
  ];
  return (
    <>
      <PageHeader title={s.labels().revenue} description="売上は台帳に1件ずつ記録し、集計は台帳から自動で作ります。締めた月は変更できません。" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "ledger" && <Ledger initialCustomer={sp.get("customer") ?? ""} />}
      {tab === "summary" && <SummaryView />}
      {tab === "closing" && <ClosingView />}
      {tab === "performance" && <PerformanceView />}
    </>
  );
}

function Ledger({ initialCustomer }: { initialCustomer: string }) {
  const s = useSession();
  const [month, setMonth] = useState(initialCustomer ? "" : thisMonth());
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState<"" | Revenue["status"]>("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const { data, loading, reload, error } = useApi<Row[]>("revenues.list", { filter: { month: month || undefined, productId: productId || undefined, status: status || undefined, unpaidOnly, customerId: initialCustomer || undefined } });
  const [payment, setPayment] = useState<Row | null>(null);
  const [adjust, setAdjust] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const editable = can(s.user, "revenues.edit");
  const total = (data ?? []).filter((r) => r.status !== "canceled").reduce((a, r) => a + r.amountIncl, 0);
  const STATUS = { planned: ["予定", "blue"], confirmed: ["確定", "green"], canceled: ["取消", "slate"], refunded: ["返金済", "amber"] } as const;
  const KIND = { sale: "売上", refund: "返金", discount: "値引き", adjustment: "調整" } as const;
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" className="w-auto" aria-label="計上月" value={month} onChange={(e) => setMonth(e.target.value)} />
          <ProductPicker value={productId} onChange={setProductId} allowAll />
          <Select aria-label="状態" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">状態：すべて</option>
            <option value="planned">予定</option>
            <option value="confirmed">確定</option>
            <option value="refunded">返金済</option>
            <option value="canceled">取消</option>
          </Select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} /> 未入金のみ
          </label>
          {can(s.user, "csv.export") && month && (
            <Button size="sm" variant="secondary" onClick={async () => downloadText(`revenue-${month}.csv`, await call<string>("revenues.csv", { month, productId: productId || undefined }))}>
              会計ソフト用CSV
            </Button>
          )}
          <span className="ml-auto text-sm">
            合計 <b className="tabular-nums">{yen(total)}</b>（{data?.length ?? 0}件）
          </span>
        </div>
      </Card>
      {error && <Alert tone="error">{error.message}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>該当する売上はありません</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">計上月</th>
                  <th className="px-3 py-2">顧客</th>
                  <th className="px-3 py-2">商材・プラン</th>
                  <th className="px-3 py-2">区分</th>
                  <th className="px-3 py-2 text-right">税抜</th>
                  <th className="px-3 py-2 text-right">税額</th>
                  <th className="px-3 py-2 text-right">税込</th>
                  <th className="px-3 py-2">支払</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 tabular-nums">
                      {r.month}
                      {r.closed && <span className="ml-1 text-xs text-slate-400">🔒</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Link className="text-brand-700 hover:underline" to={`/customers/${r.customerId}`}>
                        {r.customerName}
                      </Link>
                      <div className="text-xs text-slate-400">{s.userName(r.owner)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.productName}
                      <br />
                      {r.planName}
                      {r.installmentNo ? `（${r.installmentNo}回目）` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs">{KIND[r.kind]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.amountExcl.toLocaleString("ja-JP")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.tax.toLocaleString("ja-JP")}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.amountIncl.toLocaleString("ja-JP")}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.paymentMethod}
                      {r.dueDate && <div className="text-slate-400">予定 {r.dueDate}</div>}
                      {r.paidAt ? <div className="text-emerald-700">入金 {r.paidAt}</div> : r.overdue ? <div className="font-bold text-rose-700">入金遅れ</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                      {r.note && <div className="mt-1 max-w-40 text-[11px] text-slate-500">{r.note}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {editable && (
                        <div className="flex flex-col gap-1">
                          {r.kind === "sale" && !r.paidAt && r.status !== "canceled" && (
                            <Button size="sm" variant="secondary" onClick={() => setPayment(r)}>
                              入金を記録
                            </Button>
                          )}
                          {r.kind === "sale" && r.status !== "canceled" && (
                            <Button size="sm" variant="ghost" onClick={() => setAdjust(r)}>
                              返金・値引き
                            </Button>
                          )}
                          {!r.closed && (
                            <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
                              編集
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {payment && <PaymentDialog row={payment} onClose={() => setPayment(null)} onDone={() => { setPayment(null); void reload(); }} />}
      {adjust && <AdjustDialog row={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); void reload(); }} />}
      {edit && <EditDialog row={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void reload(); }} />}
    </>
  );
}

function PaymentDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [paidAt, setPaidAt] = useState(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
  const [amount, setAmount] = useState(String(row.amountIncl));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open title={`入金の記録：${row.customerName}`} onClose={onClose} footer={<Button onClick={async () => { try { await call("revenues.payment", { id: row.id, paidAt, amount: Number(amount) }); onDone(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>記録する</Button>}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="入金日">
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
        <Field label="入金額（税込）">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function AdjustDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"refund" | "discount" | "adjustment">("refund");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={`返金・値引き：${row.customerName}`}
      onClose={onClose}
      footer={
        <Button onClick={async () => { try { await call("revenues.adjust", { parentId: row.id, adjustment: { kind, amountIncl: Number(amount), month, note } }); onDone(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>
          登録する
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-600">元の売上（{row.month}・{yen(row.amountIncl)}）に紐付けて、マイナスの売上として記録します。締めた月を指定した場合は、翌月以降の最初の未締めの月に計上します。</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="区分">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="refund">返金</option>
            <option value="discount">値引き</option>
            <option value="adjustment">調整（プラスも可）</option>
          </Select>
        </Field>
        <Field label="金額（税込）">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="計上月">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
      </div>
      <Field label="理由・メモ">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

function EditDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amountIncl: String(row.amountIncl), month: row.month, status: row.status, note: row.note, dueDate: row.dueDate ?? "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title="売上の編集"
      onClose={onClose}
      footer={
        <Button onClick={async () => { try { await call("revenues.update", { id: row.id, patch: { amountIncl: Number(f.amountIncl), month: f.month, status: f.status, note: f.note, dueDate: f.dueDate || null } }); onDone(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>
          保存
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="金額（税込）">
          <Input type="number" value={f.amountIncl} onChange={(e) => setF({ ...f, amountIncl: e.target.value })} />
        </Field>
        <Field label="計上月">
          <Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </Field>
        <Field label="状態">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Revenue["status"] })}>
            <option value="planned">予定</option>
            <option value="confirmed">確定</option>
            <option value="canceled">取消</option>
          </Select>
        </Field>
        <Field label="入金予定日">
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <Field label="メモ">
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </Modal>
  );
}

function SummaryView() {
  const s = useSession();
  const [to, setTo] = useState(thisMonth());
  const [span, setSpan] = useState(6);
  const [groupBy, setGroupBy] = useState<"plan" | "product" | "owner">("plan");
  const [productId, setProductId] = useState("");
  const [includePlanned, setIncludePlanned] = useState(true);
  const from = shiftMonth(to, -(span - 1));
  const { data, loading, error } = useApi<Summary>("revenues.summary", { from, to, groupBy, productId: productId || undefined, includePlanned });
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" className="w-auto" aria-label="最終月" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select aria-label="期間" className="w-auto" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            <option value={3}>3か月</option>
            <option value={6}>6か月</option>
            <option value={12}>12か月</option>
          </Select>
          <Select aria-label="集計の単位" className="w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="plan">プラン別</option>
            <option value="product">商材別</option>
            <option value="owner">担当営業別</option>
          </Select>
          <ProductPicker value={productId} onChange={setProductId} allowAll />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={includePlanned} onChange={(e) => setIncludePlanned(e.target.checked)} /> 予定も含める
          </label>
          {can(s.user, "revenues.summary") && (
            <Button size="sm" variant="ghost" onClick={() => call("summary.export")}>
              管理シートへ書き出す
            </Button>
          )}
        </div>
      </Card>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <Card title={<span>合計 {yen(data.total)} ・ 前月比 {pct(data.mom)} ・ 前年同月比 {pct(data.yoy)}</span>}>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">{groupBy === "plan" ? "プラン" : groupBy === "product" ? "商材" : "担当営業"}</th>
                  {data.months.map((m) => (
                    <th key={m} className="px-3 py-2 text-right">
                      {m}
                      {data.closedMonths.includes(m) && " 🔒"}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">合計</th>
                  <th className="px-3 py-2 text-right">前月比</th>
                  <th className="px-3 py-2 text-right">前年同月比</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.key} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{groupBy === "owner" ? s.userName(g.key) : g.label}</td>
                    {data.months.map((m) => (
                      <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                        {(g.months[m] ?? 0).toLocaleString("ja-JP")}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{g.total.toLocaleString("ja-JP")}</td>
                    <td className="px-3 py-1.5 text-right text-xs">{pct(g.mom)}</td>
                    <td className="px-3 py-1.5 text-right text-xs">{pct(g.yoy)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="px-3 py-1.5">合計</td>
                  {data.months.map((m) => (
                    <td key={m} className="px-3 py-1.5 text-right tabular-nums">
                      {(data.totals[m] ?? 0).toLocaleString("ja-JP")}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums">{data.total.toLocaleString("ja-JP")}</td>
                  <td className="px-3 py-1.5 text-right text-xs">{pct(data.mom)}</td>
                  <td className="px-3 py-1.5 text-right text-xs">{pct(data.yoy)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            計上ルール：{s.activeProducts.map((p) => `${p.name}＝${REVENUE_RULE_LABELS[p.revenueRule]}`).join("、")}（プランごとに変更できます）
          </p>
        </Card>
      ) : null}
    </>
  );
}

function ClosingView() {
  const s = useSession();
  const { data, reload } = useApi<Closing[]>("months.list");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth(), -i));
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Card title="月次締め">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <p className="mb-2 text-sm text-slate-600">締めた月の売上は編集できなくなります。あとからの修正は翌月の調整として記録します。解除はオーナーのみ・理由が必要です。</p>
      <table className="w-full text-sm">
        <tbody>
          {months.map((m) => {
            const c = data?.find((x) => x.month === m);
            const closed = c?.status === "closed";
            return (
              <tr key={m} className="border-t border-slate-100">
                <td className="py-2 font-semibold tabular-nums">{m}</td>
                <td className="py-2">
                  {closed ? <Badge tone="green">締め済み</Badge> : <Badge tone="amber">未締め</Badge>}
                  {c && <span className="ml-2 text-xs text-slate-500">{closed ? `${c.closedAt.slice(0, 10)} ${s.userName(c.closedBy)}` : c.reopenedAt ? `解除：${c.reopenReason}（${s.userName(c.reopenedBy)}）` : ""}</span>}
                </td>
                <td className="py-2 text-right">
                  {closed ? (
                    can(s.user, "months.reopen") && (
                      <span className="inline-flex gap-1">
                        <Input className="w-40 py-1" placeholder="解除の理由" value={reason[m] ?? ""} onChange={(e) => setReason({ ...reason, [m]: e.target.value })} />
                        <Button size="sm" variant="danger" onClick={() => act(() => call("months.reopen", { month: m, reason: reason[m] ?? "" }), `${m} の締めを解除しました`)}>
                          解除
                        </Button>
                      </span>
                    )
                  ) : m <= thisMonth() ? (
                    <Button size="sm" onClick={() => confirm(`${m} を締めますか？`) && act(() => call("months.close", { month: m }), `${m} を締めました`)}>
                      締める
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function PerformanceView() {
  const s = useSession();
  const [from, setFrom] = useState(shiftMonth(thisMonth(), -2));
  const [to, setTo] = useState(thisMonth());
  const { data } = useApi<{ owner: string; count: number; amount: number; average: number }[]>("revenues.performance", { from, to });
  return (
    <Card
      title="担当営業ごとの成約"
      actions={
        <>
          <Input type="month" className="w-auto" aria-label="開始月" value={from} onChange={(e) => setFrom(e.target.value)} />〜
          <Input type="month" className="w-auto" aria-label="終了月" value={to} onChange={(e) => setTo(e.target.value)} />
        </>
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">担当営業</th>
            <th className="py-1 text-right">成約件数</th>
            <th className="py-1 text-right">金額</th>
            <th className="py-1 text-right">平均単価</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.owner} className="border-t border-slate-100">
              <td className="py-1">{s.userName(r.owner)}</td>
              <td className="py-1 text-right tabular-nums">{r.count}</td>
              <td className="py-1 text-right tabular-nums">{yen(r.amount)}</td>
              <td className="py-1 text-right tabular-nums">{yen(r.average)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.length === 0 && <Empty>この期間の成約はありません</Empty>}
    </Card>
  );
}
