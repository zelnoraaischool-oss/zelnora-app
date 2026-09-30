import { can, type Delivery, type ProgressItem } from "@zelnora/core";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OwnerSwitch, ProductPicker, UserSelect } from "../components/pickers";
import { Alert, Badge, Button, Card, cx, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from "../components/ui";
import { call, useApi } from "../lib/api";
import { useSession } from "../lib/session";

type Matrix = ReturnType<typeof import("@zelnora/core").progressMatrix>;
type Detail = ReturnType<typeof import("@zelnora/core").deliveryDetail>;

const STATE_STYLE: Record<string, { cls: string; mark: string; label: string }> = {
  done: { cls: "bg-emerald-100 text-emerald-800", mark: "✓", label: "完了" },
  absent: { cls: "bg-slate-200 text-slate-600", mark: "欠", label: "欠席" },
  planned: { cls: "bg-white text-slate-500 ring-1 ring-slate-200", mark: "・", label: "予定" },
  this_week: { cls: "bg-sky-100 text-sky-800", mark: "今", label: "今週" },
  overdue: { cls: "bg-rose-100 text-rose-800 font-bold", mark: "!", label: "遅れ" },
  canceled: { cls: "bg-slate-50 text-slate-300 line-through", mark: "－", label: "取消" },
};

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 提供の進捗の表（ZN-DLV-03/04） */
export function DeliveryPage() {
  const s = useSession();
  const [sp, setSp] = useSearchParams();
  const productId = sp.get("product") || s.activeProducts[0]?.id || "";
  const [owner, setOwner] = useState(s.user.role === "delivery" ? "me" : "all");
  const [status, setStatus] = useState<"" | "all" | "completed" | "canceled">("");
  const { data, loading, error, reload } = useApi<Matrix>(productId ? "deliveries.matrix" : null, { productId, owner, status: status || undefined });
  const [cell, setCell] = useState<{ itemId: string; name: string; deliveryId: string } | null>(null);
  const openId = sp.get("open");
  const L = s.labels(productId);
  if (!productId) return <Alert tone="info">担当の商材がありません。</Alert>;
  return (
    <>
      <PageHeader
        title={`${L.delivery}の進捗`}
        actions={
          <>
            <ProductPicker value={productId} onChange={(v) => setSp({ product: v })} />
            <OwnerSwitch value={owner} onChange={setOwner} roles={["delivery", "manager"]} productId={productId} />
            <Select aria-label="状態" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">進行中</option>
              <option value="completed">修了</option>
              <option value="canceled">解約</option>
              <option value="all">すべて</option>
            </Select>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(STATE_STYLE).map(([k, v]) => (
          <span key={k} className={cx("rounded px-1.5 py-0.5", v.cls)}>
            {v.mark} {v.label}
          </span>
        ))}
      </div>
      {error && <Alert tone="error">{error.message}</Alert>}
      <Card>
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>{L.delivery}はありません</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-44 bg-white px-3 py-2">{L.customer}</th>
                  <th className="px-2 py-2">進捗</th>
                  {data.columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-1 py-2 text-center font-medium">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.delivery.id} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                      <button type="button" className="text-left font-semibold text-brand-700 hover:underline" onClick={() => setSp({ product: productId, open: r.delivery.id })}>
                        {r.customer.name}
                      </button>
                      <div className="text-[11px] text-slate-500">
                        {r.planName}・{s.userName(r.delivery.owner)}
                      </div>
                      {r.risks.map((x) => (
                        <div key={x} className="text-[11px] font-semibold text-rose-700">
                          ⚠ {x}
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-xs tabular-nums">{r.progressRate}%</td>
                    {data.columns.map((c) => {
                      const v = r.cells[c.key];
                      if (!v) return <td key={c.key} />;
                      const st = STATE_STYLE[v.state]!;
                      return (
                        <td key={c.key} className="px-0.5 py-1 text-center">
                          <button
                            type="button"
                            title={`${c.name}：${st.label}（${v.doneAt ?? v.dueDate}）`}
                            className={cx("h-8 w-12 rounded text-xs", st.cls)}
                            onClick={() => setCell({ itemId: v.id, name: c.name, deliveryId: r.delivery.id })}
                          >
                            <span className="block leading-3">{st.mark}</span>
                            <span className="block text-[10px] leading-3">{(v.doneAt ?? v.dueDate).slice(5)}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {cell && <ItemDialog deliveryId={cell.deliveryId} itemId={cell.itemId} onClose={() => setCell(null)} onDone={() => { setCell(null); void reload(); }} />}
      {openId && (
        <DeliveryDialog
          id={openId}
          onClose={() => setSp({ product: productId })}
          onChanged={() => void reload()}
        />
      )}
    </>
  );
}

/** セッションの記録：実施日・出欠・内容・宿題・次回の予定（ZN-DLV-05） */
function ItemDialog({ deliveryId, itemId, onClose, onDone }: { deliveryId: string; itemId: string; onClose: () => void; onDone: () => void }) {
  const s = useSession();
  const { data } = useApi<Detail>("deliveries.get", { id: deliveryId });
  const item = data?.items.find((i) => i.id === itemId);
  const [date, setDate] = useState(today());
  const [attendance, setAttendance] = useState<"attended" | "absent" | "rescheduled">("attended");
  const [content, setContent] = useState("");
  const [homework, setHomework] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editable = can(s.user, "deliveries.edit") && (s.user.role !== "delivery" || data?.delivery.owner === s.user.email);
  if (!data || !item) return null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal
      open
      title={`${data.customer?.name}：${item.name}`}
      onClose={onClose}
      footer={
        editable ? (
          item.status === "planned" ? (
            item.completion === "session" ? (
              <Button onClick={() => run(() => call("deliveries.recordSession", { itemId, record: { date, attendance, content, homework, nextDate: nextDate || null } }))}>記録して完了</Button>
            ) : (
              <Button onClick={() => run(() => call("deliveries.completeItem", { itemId, date }))}>完了にする</Button>
            )
          ) : item.status === "done" ? (
            <Button variant="secondary" onClick={() => run(() => call("deliveries.reopenItem", { itemId }))}>
              未完了に戻す
            </Button>
          ) : undefined
        ) : undefined
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm">
        予定日：{item.dueDate} ・ 状態：{item.status === "done" ? `完了（${item.doneAt}）` : item.status === "canceled" ? "取消" : "予定"}
      </p>
      {item.record && (
        <div className="rounded-lg bg-slate-50 p-2 text-sm">
          <div>出欠：{item.record.attendance === "attended" ? "実施" : item.record.attendance === "absent" ? "欠席" : "振替"}</div>
          {item.record.content && <div className="whitespace-pre-line">内容：{item.record.content}</div>}
          {item.record.homework && <div>宿題：{item.record.homework}</div>}
        </div>
      )}
      {editable && item.status === "planned" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="実施日">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {item.completion === "session" && (
              <Field label="出欠">
                <Select value={attendance} onChange={(e) => setAttendance(e.target.value as typeof attendance)}>
                  <option value="attended">実施</option>
                  <option value="absent">欠席</option>
                  <option value="rescheduled">振替（日付を変える）</option>
                </Select>
              </Field>
            )}
          </div>
          {item.completion === "session" && (
            <>
              <Field label="内容">
                <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
              </Field>
              <Field label="宿題">
                <Input value={homework} onChange={(e) => setHomework(e.target.value)} />
              </Field>
              <Field label={attendance === "rescheduled" ? "振替後の日付" : "次回の予定日"} hint="次の予定の日付をこの日に変更します" required={attendance === "rescheduled"}>
                <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function DeliveryDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const s = useSession();
  const { data, error, reload } = useApi<Detail>("deliveries.get", { id });
  const [mode, setMode] = useState<"" | "pause" | "extend" | "finish" | "owner">("");
  const [f, setF] = useState({ from: today(), to: today(), reason: "", endDate: "", status: "completed" as "completed" | "canceled" | "plan_changed", date: today(), owner: "", note: "", score: "", comment: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (error) return <Modal open title="エラー" onClose={onClose}><Alert tone="error">{error.message}</Alert></Modal>;
  if (!data) return null;
  const d: Delivery = data.delivery;
  const L = s.labels(d.productId);
  const editable = can(s.user, "deliveries.edit") && (s.user.role !== "delivery" || d.owner === s.user.email);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      setMode("");
      await reload();
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  const statusLabel = { active: "進行中", paused: "休止中", completed: "修了", canceled: "解約", plan_changed: "プラン変更" }[d.status];
  return (
    <Modal open wide title={`${data.customer?.name ?? ""}の${L.delivery}`} onClose={onClose}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={d.status === "active" ? "teal" : "slate"}>{statusLabel}</Badge>
        <span>{data.plan.name}</span>
        <span className="text-slate-500">
          {d.startDate} 〜 {d.endDate}
        </span>
        <span className="text-slate-500">
          {L.deliveryOwner}：{s.userName(d.owner)}
        </span>
        {data.customer && (
          <Link to={`/customers/${data.customer.id}`} className="text-brand-700 hover:underline">
            {L.customer}の詳細 →
          </Link>
        )}
      </div>
      {d.pauses.length > 0 && <p className="text-xs text-slate-500">休止：{d.pauses.map((p) => `${p.from}〜${p.to}（${p.reason}）`).join("、")}</p>}
      {d.endReason && <p className="text-xs text-slate-500">終了の理由：{d.endReason}</p>}
      {Object.keys(d.fields).length > 0 && (
        <dl className="grid grid-cols-[10rem_1fr] gap-1 text-xs">
          {Object.entries(d.fields).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{s.product(d.productId)?.customFields.delivery.find((x) => x.key === k)?.label ?? k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {editable && (d.status === "active" || d.status === "paused") && (
        <div className="flex flex-wrap gap-2">
          {d.status === "paused" ? (
            <Button size="sm" variant="secondary" onClick={() => act(() => call("deliveries.resume", { id }), "再開しました")}>
              再開する
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setMode("pause")}>
              休止
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setMode("extend")}>
            延長
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("finish")}>
            修了・解約
          </Button>
          {can(s.user, "assign.change") && (
            <Button size="sm" variant="secondary" onClick={() => setMode("owner")}>
              担当の引き継ぎ
            </Button>
          )}
        </div>
      )}
      {mode === "pause" && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
          <Field label="休止の開始日">
            <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </Field>
          <Field label="休止の終了日">
            <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
          <Field label="理由">
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-3">休止の期間の分だけ、以降の予定日と終了日を後ろにずらします。</p>
          <Button onClick={() => act(() => call("deliveries.pause", { id, from: f.from, to: f.to, reason: f.reason }), "休止を登録しました")}>登録</Button>
        </div>
      )}
      {mode === "extend" && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <Field label="新しい終了日">
            <Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Button onClick={() => act(() => call("deliveries.extend", { id, endDate: f.endDate }), "延長しました")}>延長する</Button>
        </div>
      )}
      {mode === "finish" && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <Field label="区分">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
              <option value="completed">修了</option>
              <option value="canceled">解約</option>
              <option value="plan_changed">プラン変更</option>
            </Select>
          </Field>
          <Field label="日付">
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="理由" required={f.status !== "completed"} className="sm:col-span-2">
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          {f.status === "completed" && (
            <>
              <Field label="満足度（1〜5）">
                <Input type="number" min={1} max={5} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
              </Field>
              <Field label="アンケートのコメント">
                <Input value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
              </Field>
            </>
          )}
          <p className="text-xs text-slate-500 sm:col-span-2">残りの予定は取り消します。{f.status === "canceled" && "月額の売上は解約月の翌月から止めます。返金は売上台帳で登録してください。"}</p>
          <Button
            variant={f.status === "completed" ? "primary" : "danger"}
            onClick={() =>
              act(
                () => call("deliveries.finish", { id, finish: { status: f.status, date: f.date, reason: f.reason, satisfaction: f.score ? { score: Number(f.score), comment: f.comment } : null } }),
                "登録しました",
              )
            }
          >
            登録する
          </Button>
        </div>
      )}
      {mode === "owner" && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3">
          <Field label={`新しい${L.deliveryOwner}`}>
            <UserSelect value={f.owner} onChange={(v) => setF({ ...f, owner: v })} roles={["delivery", "manager"]} />
          </Field>
          <Field label="引き継ぎメモ" required>
            <Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <Button onClick={() => act(() => call("deliveries.changeOwner", { id, owner: f.owner, note: f.note }), "引き継ぎました")}>引き継ぐ</Button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">{L.progressItem}</th>
            <th className="py-1">予定日</th>
            <th className="py-1">状態</th>
            <th className="py-1">記録</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i: ProgressItem) => (
            <tr key={i.id} className="border-t border-slate-100">
              <td className="py-1">{i.name}</td>
              <td className="py-1 tabular-nums">{i.dueDate}</td>
              <td className="py-1">{i.status === "done" ? <Badge tone="green">完了 {i.doneAt?.slice(5)}</Badge> : i.status === "canceled" ? <Badge>取消</Badge> : i.dueDate < today() ? <Badge tone="red">遅れ</Badge> : <Badge tone="blue">予定</Badge>}</td>
              <td className="py-1 text-xs text-slate-600">{i.record ? `${i.record.attendance === "absent" ? "欠席" : i.record.attendance === "rescheduled" ? "振替" : "実施"} ${i.record.content ?? ""}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
