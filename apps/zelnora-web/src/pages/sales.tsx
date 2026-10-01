import { can, type Deal, type Stage, type Target } from "@zelnora/core";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DealDialog, MoveStageDialog } from "../components/deal-dialog";
import { EsignBadge } from "../components/esign-panel";
import { OwnerSwitch, ProductPicker } from "../components/pickers";
import { Alert, Badge, Button, Card, cx, Empty, Field, Input, Loading, Modal, PageHeader, Select, Tabs, yen } from "../components/ui";
import { call, useApi } from "../lib/api";
import { guessField, parseCsv } from "../lib/csv";
import { useSession } from "../lib/session";

type Board = ReturnType<typeof import("@zelnora/core").salesBoard>;
type Funnel = ReturnType<typeof import("@zelnora/core").funnel>;

export function SalesPage() {
  const s = useSession();
  const [productId, setProductId] = useState(s.activeProducts[0]?.id ?? "");
  const [owner, setOwner] = useState(s.user.role === "sales" ? "me" : "all");
  const [tab, setTab] = useState<"board" | "list" | "funnel" | "targets">("board");
  const [newLead, setNewLead] = useState(false);
  const [rev, setRev] = useState(0);
  const [csv, setCsv] = useState(false);
  const L = s.labels(productId);
  if (!productId) return <Alert tone="info">担当の商材がありません。設定で商材を追加するか、担当商材の割り当てを依頼してください。</Alert>;
  return (
    <>
      <PageHeader
        title="営業"
        actions={
          <>
            <ProductPicker value={productId} onChange={setProductId} />
            <OwnerSwitch value={owner} onChange={setOwner} roles={["sales", "manager"]} productId={productId} />
            {can(s.user, "deals.edit") && (
              <Button variant="secondary" onClick={() => setCsv(true)}>
                CSVで取り込む
              </Button>
            )}
            {can(s.user, "deals.edit") && <Button onClick={() => setNewLead(true)}>＋ {L.lead}を登録</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "board", label: "ボード" },
          { id: "list", label: "一覧" },
          { id: "funnel", label: "ファネル・失注" },
          { id: "targets", label: "目標と達成率" },
        ]}
      />
      {tab === "board" && <BoardView key={rev} productId={productId} owner={owner} />}
      {tab === "list" && <ListView key={rev} productId={productId} owner={owner} />}
      {tab === "funnel" && <FunnelView productId={productId} />}
      {tab === "targets" && <TargetsView productId={productId} />}
      {csv && <CsvImportDialog productId={productId} onClose={() => setCsv(false)} onDone={() => { setCsv(false); setRev(rev + 1); }} />}
      {newLead && <NewLeadDialog productId={productId} onClose={() => setNewLead(false)} onDone={() => { setNewLead(false); setRev(rev + 1); }} />}
    </>
  );
}

function BoardView({ productId, owner }: { productId: string; owner: string }) {
  const s = useSession();
  const { data, loading, reload, error } = useApi<Board>("deals.board", { productId, owner });
  const [dragging, setDragging] = useState<string | null>(null);
  const [move, setMove] = useState<{ deal: Deal; stage: Stage } | null>(null);
  const [open, setOpen] = useState<Deal | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const canEdit = can(s.user, "deals.edit");
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const tryMove = async (deal: Deal, stage: Stage) => {
    if (deal.stageId === stage.id) return;
    // 必須項目がなければそのまま移動し、足りなければ入力欄を出す
    try {
      if (stage.requiredFields.length || ["registered"].includes(stage.kind)) throw new Error("needs input");
      await call("deals.move", { id: deal.id, move: { stageId: stage.id } });
      void reload();
    } catch {
      setMove({ deal, stage });
    }
  };
  return (
    <>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {data.columns.map((col) => (
          <section
            key={col.stage.id}
            aria-label={col.stage.name}
            className={cx("flex w-64 shrink-0 flex-col rounded-xl bg-slate-100 p-2", dragging && "outline-2 outline-dashed outline-slate-300")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const card = data.columns.flatMap((c) => c.cards).find((c) => c.deal.id === id);
              setDragging(null);
              if (card) void tryMove(card.deal, col.stage);
            }}
          >
            <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-bold">
              <span>
                {col.stage.name}
                {col.stage.kind === "lost" && <span className="ml-1 text-xs font-normal text-slate-500">（直近30日）</span>}
              </span>
              <span className="text-xs text-slate-500">
                {col.cards.length}件・{yen(col.cards.reduce((a, c) => a + (c.deal.amount ?? 0), 0))}
              </span>
            </h3>
            <div className="flex flex-1 flex-col gap-2">
              {col.cards.map((c) => (
                <article
                  key={c.deal.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", c.deal.id);
                    setDragging(c.deal.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cx("relative cursor-pointer rounded-lg bg-white p-2 text-sm shadow-sm ring-1", c.stale ? "ring-amber-400" : "ring-slate-200", c.overdue && "border-l-4 border-rose-500")}
                  onClick={() => setOpen(c.deal)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-semibold">{c.customerName}</span>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label="メニュー"
                        className="rounded px-1 text-slate-400 hover:bg-slate-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(menu === c.deal.id ? null : c.deal.id);
                        }}
                      >
                        ⋯
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.planName || "プラン未定"} {c.deal.amount ? `・${yen(c.deal.amount)}` : ""}
                  </div>
                  {c.deal.esign && (
                    <div className="mt-1">
                      <EsignBadge esign={c.deal.esign} />
                    </div>
                  )}
                  {c.deal.nextAction && (
                    <div className={cx("mt-1 text-xs", c.overdue ? "font-bold text-rose-700" : "text-slate-700")}>
                      {c.deal.nextAction.due.slice(5)} {c.deal.nextAction.title}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{s.userName(c.deal.owner)}</span>
                    <span className={c.stale ? "font-bold text-amber-700" : ""}>
                      {c.daysInStage}日{c.stale ? "（滞在が長い）" : ""}
                    </span>
                  </div>
                  {menu === c.deal.id && (
                    <div className="absolute right-1 top-7 z-10 w-44 rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
                      <p className="px-2 py-1 text-xs text-slate-500">段階を変更</p>
                      {data.columns.map((x) => (
                        <button
                          key={x.stage.id}
                          type="button"
                          disabled={x.stage.id === c.deal.stageId}
                          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100 disabled:text-slate-300"
                          onClick={() => {
                            setMenu(null);
                            void tryMove(c.deal, x.stage);
                          }}
                        >
                          {x.stage.name}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {col.cards.length === 0 && <p className="py-4 text-center text-xs text-slate-400">ここにドラッグ</p>}
            </div>
          </section>
        ))}
      </div>
      {move && (
        <MoveStageDialog
          deal={move.deal}
          product={data.product}
          target={move.stage}
          onClose={() => setMove(null)}
          onDone={() => {
            setMove(null);
            void reload();
          }}
        />
      )}
      {open && (
        <DealDialog
          deal={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

type DealRow = Deal & { customerName: string; stageName: string; planName: string; daysInStage: number };

function ListView({ productId, owner }: { productId: string; owner: string }) {
  const s = useSession();
  const filter = { productId, ...(owner === "me" ? { owner: s.user.email } : owner !== "all" ? { owner } : {}) };
  const { data, loading } = useApi<DealRow[]>("deals.list", { filter });
  const [sort, setSort] = useState<"stage" | "amount" | "due" | "owner">("due");
  const rows = [...(data ?? [])].sort((a, b) => {
    if (sort === "amount") return (b.amount ?? 0) - (a.amount ?? 0);
    if (sort === "owner") return (a.owner ?? "").localeCompare(b.owner ?? "");
    if (sort === "stage") {
      const order = (d: DealRow) => s.product(d.productId)?.stages.find((x) => x.id === d.stageId)?.order ?? 0;
      return order(a) - order(b);
    }
    return (a.nextAction?.due ?? "9999").localeCompare(b.nextAction?.due ?? "9999");
  });
  return (
    <Card
      title={`${rows.length}件`}
      actions={
        <Select aria-label="並べ替え" className="w-auto py-1" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="due">期限順</option>
          <option value="stage">段階順</option>
          <option value="amount">金額順</option>
          <option value="owner">担当者順</option>
        </Select>
      }
    >
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">顧客</th>
                <th className="px-3 py-2">段階</th>
                <th className="px-3 py-2">プラン</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2">次のアクション</th>
                <th className="px-3 py-2">担当</th>
                <th className="px-3 py-2 text-right">滞在日数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link className="font-semibold text-brand-700 hover:underline" to={`/customers/${d.customerId}`}>
                      {d.customerName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={d.status === "won" ? "green" : d.status === "lost" ? "red" : "blue"}>{d.stageName}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">{d.planName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{yen(d.amount)}</td>
                  <td className="px-3 py-2 text-xs">{d.nextAction ? `${d.nextAction.due} ${d.nextAction.title}` : ""}</td>
                  <td className="px-3 py-2 text-xs">{s.userName(d.owner)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.daysInStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>商談はありません</Empty>}
        </div>
      )}
    </Card>
  );
}

function FunnelView({ productId }: { productId: string }) {
  const s = useSession();
  const [groupBy, setGroupBy] = useState<"" | "owner" | "source">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, loading } = useApi<Funnel>("deals.funnel", { productId, groupBy: groupBy || null, from: from || undefined, to: to || undefined });
  const max = Math.max(1, ...(data?.stages.map((x) => x.count) ?? [1]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="内訳" className="w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
          <option value="">全体</option>
          <option value="owner">担当者別</option>
          <option value="source">流入経路別</option>
        </Select>
        <Input type="date" className="w-auto" aria-label="登録日（から）" value={from} onChange={(e) => setFrom(e.target.value)} />〜
        <Input type="date" className="w-auto" aria-label="登録日（まで）" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <Card title="段階ごとの件数と移行率">
            <div className="space-y-2">
              {data.stages.map((st) => (
                <div key={st.stageId} className="grid grid-cols-[8rem_1fr_9rem] items-center gap-2 text-sm">
                  <span>{st.name}</span>
                  <div className="h-5 rounded bg-slate-100">
                    <div className="h-5 rounded bg-brand-600" style={{ width: `${(st.count / max) * 100}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-slate-600">
                    {st.count}件 {st.conversion !== null && `→ ${st.conversion}%`} {st.avgDays !== null && `・平均${st.avgDays}日`}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          {data.groups.length > 0 && (
            <Card title={groupBy === "owner" ? "担当者別" : "流入経路別"}>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-1" />
                      {data.stages.map((st) => (
                        <th key={st.stageId} className="px-3 py-1 text-right">
                          {st.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.groups.map((g) => (
                      <tr key={g.key} className="border-t border-slate-100">
                        <td className="px-3 py-1">{groupBy === "owner" ? s.userName(g.key) : g.key}</td>
                        {g.stages.map((st) => (
                          <td key={st.stageId} className="px-3 py-1 text-right tabular-nums">
                            {st.count}
                            {st.conversion !== null && <span className="ml-1 text-xs text-slate-500">({st.conversion}%)</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <Card title={`失注の分析（${data.lost.total}件）`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">理由</p>
                {Object.entries(data.lost.reasons).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">失注した段階</p>
                {Object.entries(data.lost.byStage).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

type Perf = { owner: string; count: number; amount: number; average: number }[];

function TargetsView({ productId: _productId }: { productId: string }) {
  const s = useSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const targets = useApi<Target[]>("targets.list", { month });
  const perf = useApi<Perf>(can(s.user, "revenues.summary") ? "revenues.performance" : null, { from: month, to: month });
  const [edit, setEdit] = useState<Record<string, { count: string; amount: string }>>({});
  useEffect(() => setEdit({}), [month]);
  const sales = s.users.filter((u) => u.active && u.role === "sales" && (s.user.role !== "sales" || u.email === s.user.email));
  return (
    <Card title="目標と達成率" actions={<Input type="month" className="w-auto" aria-label="月" value={month} onChange={(e) => setMonth(e.target.value)} />}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">担当者</th>
            <th className="py-1 text-right">目標（件・金額）</th>
            <th className="py-1 text-right">実績</th>
            <th className="py-1 text-right">達成率</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((u) => {
            const t = targets.data?.find((x) => x.user === u.email);
            const p = perf.data?.find((x) => x.owner === u.email);
            const e = edit[u.email];
            const rate = t?.amount ? Math.round(((p?.amount ?? 0) / t.amount) * 100) : null;
            return (
              <tr key={u.email} className="border-t border-slate-100">
                <td className="py-1">{u.name}</td>
                <td className="py-1 text-right">
                  {can(s.user, "assign.change") ? (
                    <span className="inline-flex items-center gap-1">
                      <Input className="w-16 py-1" aria-label="目標件数" value={e?.count ?? String(t?.count ?? "")} onChange={(ev) => setEdit({ ...edit, [u.email]: { count: ev.target.value, amount: e?.amount ?? String(t?.amount ?? "") } })} />件
                      <Input className="w-28 py-1" aria-label="目標金額" value={e?.amount ?? String(t?.amount ?? "")} onChange={(ev) => setEdit({ ...edit, [u.email]: { count: e?.count ?? String(t?.count ?? ""), amount: ev.target.value } })} />円
                      {e && (
                        <Button size="sm" onClick={async () => { await call("targets.save", { user: u.email, month, count: Number(e.count), amount: Number(e.amount) }); await targets.reload(); setEdit({ ...edit, [u.email]: undefined as never }); }}>
                          保存
                        </Button>
                      )}
                    </span>
                  ) : (
                    <span>
                      {t?.count ?? 0}件・{yen(t?.amount ?? 0)}
                    </span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {p?.count ?? 0}件・{yen(p?.amount ?? 0)}
                </td>
                <td className="py-1 text-right tabular-nums">{rate === null ? "—" : `${rate}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function NewLeadDialog({ productId, onClose, onDone }: { productId: string; onClose: () => void; onDone: () => void }) {
  const s = useSession();
  const L = s.labels(productId);
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", source: "", planId: "", owner: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={`${L.lead}を登録`}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              await call("deals.createLead", { lead: { customer: { name: f.name, email: f.email, phone: f.phone, company: f.company, source: f.source }, productId, planId: f.planId || null, source: f.source, owner: f.owner || null } });
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          登録
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-slate-500">同じメールアドレスの{L.customer}がいれば、その{L.customer}の商談として登録します。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="氏名" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="メール">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="電話">
          <Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="会社名">
          <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
        </Field>
        <Field label="流入経路">
          <Input list="sources" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
          <datalist id="sources">
            {["Instagram", "紹介", "広告", "セミナー", "YouTube", "問い合わせフォーム"].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label={`${L.plan}の候補`}>
          <Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">未定</option>
            {s.settings.plans
              .filter((p) => p.productId === productId && p.status === "active")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        {s.user.role !== "sales" && (
          <Field label="担当営業" hint="未指定なら商材の割り当てルールに従います">
            <Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
              <option value="">自動で割り当て</option>
              {s.users
                .filter((u) => u.active && ["sales", "manager"].includes(u.role))
                .map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

const CSV_FIELDS: [string, string][] = [
  ["", "（取り込まない）"],
  ["name", "氏名"],
  ["kana", "ふりがな"],
  ["email", "メール"],
  ["phone", "電話"],
  ["company", "会社名"],
  ["source", "流入経路"],
  ["note", "メモ"],
];

type Preview = { preview: { row: number; name: string; email: string; existing: { id: string; name: string } | null; error: string | null }[]; imported: number; skipped: number };

/** CSVからのリードの取り込み（ZN-SALES-08）：列の対応付け → 重複の確認 → 取り込み */
function CsvImportDialog({ productId, onClose, onDone }: { productId: string; onClose: () => void; onDone: () => void }) {
  const s = useSession();
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<string[]>([]);
  const [source, setSource] = useState("CSV");
  const [skipExisting, setSkipExisting] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const header = table[0] ?? [];
  const body = table.slice(1);
  const rows = body.map((r) => Object.fromEntries(map.map((f, i) => [f, (r[i] ?? "").trim()]).filter(([f]) => f)) as { name: string });
  const load = (text: string) => {
    const t = parseCsv(text);
    setTable(t);
    setMap((t[0] ?? []).map(guessField));
    setPreview(null);
  };
  const run = async (dryRun: boolean) => {
    try {
      setError(null);
      const r = await call<Preview>("deals.importCsv", { productId, rows, source, dryRun, skipExisting });
      if (dryRun) setPreview(r);
      else setDone(`${r.imported}件を取り込みました（とばした行 ${r.skipped}件）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal
      open
      wide
      title={`${s.labels(productId).lead}をCSVで取り込む`}
      onClose={done ? onDone : onClose}
      footer={
        done ? (
          <Button onClick={onDone}>閉じる</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={!rows.length || !map.includes("name")} onClick={() => run(true)}>
              確認する
            </Button>
            <Button disabled={!preview} onClick={() => run(false)}>
              取り込む
            </Button>
          </>
        )
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <Field label="CSVファイル（1行目は見出し）">
        <input type="file" accept=".csv,text/csv" className="block text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); }} />
      </Field>
      {header.length > 0 && (
        <>
          <p className="text-sm font-semibold">列の対応（{body.length}行）</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {header.map((h, i) => (
              <Field key={i} label={h || `列${i + 1}`}>
                <Select value={map[i] ?? ""} onChange={(e) => { const m = [...map]; m[i] = e.target.value; setMap(m); setPreview(null); }}>
                  {CSV_FIELDS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="流入経路（列がない場合の既定）">
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
              既に登録されている人（メール・電話が同じ）はとばす
            </label>
          </div>
        </>
      )}
      {preview && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {preview.preview.map((p) => (
                <tr key={p.row} className="border-t border-slate-100">
                  <td className="py-1 text-xs text-slate-400">{p.row}</td>
                  <td className="py-1">{p.name}</td>
                  <td className="py-1 text-xs">{p.email}</td>
                  <td className="py-1 text-xs">
                    {p.error ? <Badge tone="red">{p.error}</Badge> : p.existing ? <Badge tone="amber">既存：{p.existing.name}</Badge> : <Badge tone="green">新規</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
