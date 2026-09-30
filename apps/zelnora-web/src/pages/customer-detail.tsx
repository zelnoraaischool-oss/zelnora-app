import { ACTIVITY_LABELS, type ActivityType, can, CUSTOMER_STATUS_LABELS, type CustomerStatus, type Deal } from "@zelnora/core";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DealDialog } from "../components/deal-dialog";
import { UserSelect } from "../components/pickers";
import { Alert, Badge, Button, Card, dateTime, downloadText, Empty, Field, Input, Loading, Modal, Select, Textarea, yen } from "../components/ui";
import { ApiError, call, useApi } from "../lib/api";
import { useSession } from "../lib/session";

type Detail = ReturnType<typeof import("@zelnora/core").customerDetail>;

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="ml-1 rounded px-1.5 text-xs text-brand-700 ring-1 ring-brand-600/40 hover:bg-brand-50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          // コピーできない環境
        }
      }}
    >
      {done ? "✓" : "コピー"}
    </button>
  );
}

export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const s = useSession();
  const { data, loading, error, reload } = useApi<Detail>("customers.get", { id });
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [dealOpen, setDealOpen] = useState<Deal | null>(null);
  const [newDeal, setNewDeal] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return null;
  const c = data.customer;
  const L = s.labels(data.deals[0]?.productId ?? data.deliveries[0]?.productId);
  const next = [...data.deals.filter((d) => d.status !== "lost" && d.nextAction).map((d) => d.nextAction!), ...data.deliveries.filter((d) => d.status === "active" && d.nextAction).map((d) => d.nextAction!)].sort((a, b) => (a.due < b.due ? -1 : 1))[0];
  const timeline = data.timeline.filter((t) => !typeFilter || t.type === typeFilter);
  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/customers" className="text-brand-700 hover:underline">
          ← {L.customer}一覧
        </Link>
      </div>
      <header className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">
              {c.name} {c.kana && <span className="text-sm font-normal text-slate-500">{c.kana}</span>}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
              <Badge tone={c.status === "customer" ? "green" : "blue"}>{CUSTOMER_STATUS_LABELS[c.status]}</Badge>
              {c.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
              <span className="text-xs text-slate-500">担当：{s.userName(c.salesOwner)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {c.email && (
                <span>
                  {c.email}
                  <Copy text={c.email} />
                </span>
              )}
              {c.phone && (
                <span>
                  {c.phone}
                  <Copy text={c.phone} />
                </span>
              )}
              {c.company && <span>{c.company}</span>}
            </div>
          </div>
          <div className="text-right text-sm">
            {next ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                <div className="text-xs text-amber-800">次のアクション</div>
                <div className="font-semibold">
                  {next.title}（{next.due}）
                </div>
              </div>
            ) : (
              <span className="text-xs text-slate-400">次のアクションはありません</span>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {can(s.user, "deals.edit") && (
                <Button size="sm" variant="secondary" onClick={() => setNewDeal(true)}>
                  ＋ 商談を追加
                </Button>
              )}
              {can(s.user, "customers.merge") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const json = await call<string>("customers.export", { id });
                    downloadText(`customer-${id}.json`, json, "application/json");
                  }}
                >
                  本人データを書き出す
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[20rem_1fr_20rem]">
        <InfoPanel detail={data} onSaved={reload} />
        <div className="space-y-4">
          {can(s.user, "customers.edit") && <ActivityForm customerId={id} productId={data.deals[0]?.productId ?? data.deliveries[0]?.productId} onAdded={reload} />}
          <Card
            title="時系列"
            actions={
              <Select aria-label="種類で絞り込み" className="w-auto py-1 text-xs" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">すべての種類</option>
                {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            }
          >
            {timeline.length === 0 ? (
              <Empty>記録はまだありません</Empty>
            ) : (
              <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                {timeline.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-600" />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs tabular-nums text-slate-500">{dateTime(t.at)}</span>
                      <Badge>{ACTIVITY_LABELS[t.type]}</Badge>
                      <span className="font-semibold">{t.title}</span>
                      {t.by && <span className="text-xs text-slate-400">{s.userName(t.by)}</span>}
                    </div>
                    {t.detail && <p className="whitespace-pre-line text-slate-600">{t.detail}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {data.registrations.length > 0 && (
            <Card title="フォームの回答">
              {data.registrations.map((r) => (
                <details key={r.id} className="mb-2 rounded-lg p-2 ring-1 ring-slate-200">
                  <summary className="cursor-pointer text-sm">
                    {dateTime(r.receivedAt)} <Badge tone={r.status === "ok" ? "green" : "amber"}>{r.status === "ok" ? "取り込み済み" : "確認待ち"}</Badge>
                  </summary>
                  <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
                    {Object.entries(r.answers).map(([q, a]) => (
                      <div key={q} className="contents">
                        <dt className="text-slate-500">{r.questions[q] ?? q}</dt>
                        <dd className="whitespace-pre-line">{a}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title={`商談（${data.deals.length}）`}>
            {data.deals.length === 0 && <Empty>ありません</Empty>}
            {data.deals.map((d) => {
              const p = s.product(d.productId);
              const stages = [...(p?.stages ?? [])].filter((x) => x.kind !== "lost" && x.kind !== "hold").sort((a, b) => a.order - b.order);
              const idx = stages.findIndex((x) => x.id === d.stageId);
              return (
                <button key={d.id} type="button" className="mb-2 block w-full rounded-lg p-2 text-left ring-1 ring-slate-200 hover:ring-brand-600" onClick={() => setDealOpen(d)}>
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{p?.name}</span>
                    <Badge tone={d.status === "won" ? "green" : d.status === "lost" ? "red" : "blue"}>{p?.stages.find((x) => x.id === d.stageId)?.name}</Badge>
                  </div>
                  <div className="mt-1 flex gap-0.5" aria-hidden>
                    {stages.map((x, i) => (
                      <span key={x.id} className={`h-1.5 flex-1 rounded ${d.status !== "lost" && i <= idx ? "bg-brand-600" : "bg-slate-200"}`} />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {yen(d.amount)} {d.nextAction && `・次：${d.nextAction.title}（${d.nextAction.due}）`}
                  </div>
                </button>
              );
            })}
          </Card>
          <Card title={`${L.delivery}（${data.deliveries.length}）`}>
            {data.deliveries.length === 0 && <Empty>ありません</Empty>}
            {data.deliveries.map((d) => (
              <Link key={d.id} to={`/delivery?product=${d.productId}&open=${d.id}`} className="mb-2 block rounded-lg p-2 ring-1 ring-slate-200 hover:ring-brand-600">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{s.settings.plans.find((p) => p.id === d.planId)?.name}</span>
                  <Badge tone={d.status === "active" ? "teal" : "slate"}>{d.status === "active" ? "進行中" : d.status}</Badge>
                </div>
                <div className="mt-1 h-1.5 rounded bg-slate-200">
                  <div className="h-1.5 rounded bg-teal-600" style={{ width: `${d.progressRate}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  進捗 {d.progressRate}%{d.nextItem && `・次：${d.nextItem.name}（${d.nextItem.dueDate}）`}
                  {d.overdue > 0 && <span className="ml-1 font-bold text-rose-700">遅れ{d.overdue}件</span>}
                </div>
              </Link>
            ))}
          </Card>
          {can(s.user, "revenues.view") && (
            <Card title={L.revenue}>
              <div className="flex justify-between text-sm">
                <span>合計</span>
                <b className="tabular-nums">{yen(data.revenueTotal)}</b>
              </div>
              <div className="flex justify-between text-sm">
                <span>未入金</span>
                <b className={`tabular-nums ${data.unpaid ? "text-rose-700" : ""}`}>{yen(data.unpaid)}</b>
              </div>
              <Link to={`/revenue?customer=${id}`} className="mt-2 inline-block text-xs text-brand-700 hover:underline">
                売上台帳で見る →
              </Link>
            </Card>
          )}
        </div>
      </div>
      {dealOpen && (
        <DealDialog
          deal={dealOpen}
          onClose={() => setDealOpen(null)}
          onChanged={() => {
            setDealOpen(null);
            void reload();
          }}
        />
      )}
      {newDeal && (
        <NewDealDialog
          customerId={id}
          onClose={() => setNewDeal(false)}
          onDone={() => {
            setNewDeal(false);
            void reload();
          }}
        />
      )}
    </>
  );
}

function InfoPanel({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const s = useSession();
  const c = detail.customer;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ ...c, tags: c.tags.join(" ") });
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const productIds = useMemo(() => [...new Set([...detail.deals.map((d) => d.productId), ...detail.deliveries.map((d) => d.productId)])], [detail]);
  const customFields = productIds.flatMap((pid) => (s.product(pid)?.customFields.customer ?? []).filter((x) => !(x.hiddenFromRoles ?? []).includes(s.user.role)));
  const canEdit = can(s.user, "customers.edit");
  const save = async () => {
    try {
      await call("customers.update", {
        id: c.id,
        version: c.version,
        patch: { name: f.name, kana: f.kana, email: f.email, phone: f.phone, company: f.company, source: f.source, status: f.status, note: f.note, tags: f.tags.split(/\s+/).filter(Boolean), custom: f.custom, ...(can(s.user, "assign.change") ? { salesOwner: f.salesOwner } : {}) },
      });
      setEdit(false);
      setError(null);
      setConflict(false);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") setConflict(true);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[6rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
  return (
    <Card title="基本情報" actions={canEdit && !edit ? <Button size="sm" variant="ghost" onClick={() => { setF({ ...c, tags: c.tags.join(" ") }); setEdit(true); }}>編集</Button> : undefined}>
      {error && (
        <div className="mb-2">
          <Alert tone="error">
            {error}
            {conflict && (
              <button type="button" className="ml-2 underline" onClick={onSaved}>
                最新を読み込む
              </button>
            )}
          </Alert>
        </div>
      )}
      {!edit ? (
        <dl>
          {row("氏名", c.name)}
          {row("ふりがな", c.kana)}
          {row("メール", c.email)}
          {row("電話", c.phone)}
          {row("会社名", c.company)}
          {row("流入経路", c.source)}
          {row("登録日", c.createdAt.slice(0, 10))}
          {customFields.map((cf) => row(cf.label, c.custom[cf.key]))}
          {row("メモ", <span className="whitespace-pre-line">{c.note}</span>)}
        </dl>
      ) : (
        <div className="space-y-2">
          <Field label="氏名" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="ふりがな">
            <Input value={f.kana} onChange={(e) => setF({ ...f, kana: e.target.value })} />
          </Field>
          <Field label="メール">
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="電話">
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="会社名">
            <Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
          </Field>
          <Field label="流入経路">
            <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
          </Field>
          <Field label="状態">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CustomerStatus })}>
              {Object.entries(CUSTOMER_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {can(s.user, "assign.change") && (
            <Field label="担当営業">
              <UserSelect value={f.salesOwner ?? ""} onChange={(v) => setF({ ...f, salesOwner: v || null })} roles={["sales", "manager", "admin", "owner"]} allowEmpty />
            </Field>
          )}
          <Field label="タグ（空白区切り）">
            <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
          </Field>
          {customFields.map((cf) => (
            <Field key={cf.key} label={cf.label}>
              {cf.type === "select" ? (
                <Select value={f.custom[cf.key] ?? ""} onChange={(e) => setF({ ...f, custom: { ...f.custom, [cf.key]: e.target.value } })}>
                  <option value="" />
                  {(cf.options ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : cf.type === "textarea" ? (
                <Textarea rows={2} value={f.custom[cf.key] ?? ""} onChange={(e) => setF({ ...f, custom: { ...f.custom, [cf.key]: e.target.value } })} />
              ) : (
                <Input type={cf.type === "number" ? "number" : cf.type === "date" ? "date" : "text"} value={f.custom[cf.key] ?? ""} onChange={(e) => setF({ ...f, custom: { ...f.custom, [cf.key]: e.target.value } })} />
              )}
            </Field>
          ))}
          <Field label="メモ">
            <Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={save}>保存</Button>
            <Button variant="ghost" onClick={() => setEdit(false)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ActivityForm({ customerId, productId, onAdded }: { customerId: string; productId?: string; onAdded: () => void }) {
  const s = useSession();
  const [type, setType] = useState<ActivityType>("call");
  const [result, setResult] = useState("");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const templates = s.product(productId)?.activityTemplates ?? [];
  const RESULTS: Partial<Record<ActivityType, string[]>> = { call: ["つながった", "不在", "折り返し待ち"], meeting: ["実施", "延期", "キャンセル"], message: ["送信", "返信あり"] };
  return (
    <Card title="活動・メモを記録">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem]">
        <Select aria-label="種類" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
          {(["call", "meeting", "message", "memo"] as ActivityType[]).map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_LABELS[t]}
            </option>
          ))}
        </Select>
        {RESULTS[type] ? (
          <Select aria-label="結果" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">結果を選ぶ</option>
            {RESULTS[type]!.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        ) : (
          <Input aria-label="見出し" placeholder="見出し" value={result} onChange={(e) => setResult(e.target.value)} />
        )}
        <Input aria-label="所要時間（分）" placeholder="分" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
      </div>
      <Textarea className="mt-2" rows={2} aria-label="内容" placeholder="内容" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          onClick={async () => {
            try {
              await call("activities.add", { activity: { customerId, type, result: result || (type === "memo" ? "メモ" : ""), durationMin: duration ? Number(duration) : null, note } });
              setResult("");
              setNote("");
              setDuration("");
              setError(null);
              onAdded();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          記録する
        </Button>
        {templates.length > 0 && (
          <Select aria-label="よく使う文面" className="w-auto" value="" onChange={(e) => { const t = templates[Number(e.target.value)]; if (t) { setResult(t.title); setNote(t.body); } }}>
            <option value="">よく使う文面から選ぶ</option>
            {templates.map((t, i) => (
              <option key={i} value={i}>
                {t.title}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Card>
  );
}

function NewDealDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const s = useSession();
  const [productId, setProductId] = useState(s.activeProducts[0]?.id ?? "");
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title="商談を追加"
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              await call("deals.createLead", { lead: { customer: { id: customerId, name: "-" }, productId, planId: planId || null } });
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          追加
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label={s.labels().product}>
        <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {s.activeProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${s.labels().plan}（候補）`}>
        <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
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
    </Modal>
  );
}
