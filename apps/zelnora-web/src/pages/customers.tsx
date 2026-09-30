import { can, CUSTOMER_STATUS_LABELS, type CustomerFilter, type CustomerRow, type CustomerStatus, type SavedView } from "@zelnora/core";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserSelect } from "../components/pickers";
import { Alert, Badge, Button, Card, cx, downloadText, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from "../components/ui";
import { call, useApi } from "../lib/api";
import { useSession } from "../lib/session";

const ALL_COLUMNS = [
  { key: "name", label: "氏名" },
  { key: "status", label: "状態" },
  { key: "email", label: "メール" },
  { key: "phone", label: "電話" },
  { key: "company", label: "会社名" },
  { key: "products", label: "商材・段階" },
  { key: "owner", label: "担当営業" },
  { key: "next", label: "次のアクション" },
  { key: "tags", label: "タグ" },
  { key: "source", label: "流入経路" },
  { key: "updated", label: "更新日" },
] as const;
type ColKey = (typeof ALL_COLUMNS)[number]["key"] | `custom:${string}`;

const DEFAULT_COLS: ColKey[] = ["name", "status", "email", "products", "owner", "next", "tags"];

function loadCols(): ColKey[] {
  try {
    const v = localStorage.getItem("zelnora.customerColumns");
    return v ? (JSON.parse(v) as ColKey[]) : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
}

export function CustomersPage() {
  const s = useSession();
  const L = s.labels();
  const nav = useNavigate();
  const [filter, setFilter] = useState<CustomerFilter>({ mode: "all" });
  const [cols, setCols] = useState<ColKey[]>(loadCols);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "updated", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const [bulk, setBulk] = useState<"owner" | "tags" | "status" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { data, loading, reload } = useApi<CustomerRow[]>("customers.list", { filter });
  const views = useApi<SavedView[]>("views.list", { screen: "customers" });
  const product = s.product(filter.productId);
  const customFields = useMemo(() => {
    const all = (filter.productId ? [product!] : s.activeProducts).flatMap((p) => p?.customFields.customer ?? []);
    return all.filter((f, i) => all.findIndex((x) => x.key === f.key) === i && !(f.hiddenFromRoles ?? []).includes(s.user.role));
  }, [filter.productId, product, s.activeProducts, s.user.role]);

  const rows = useMemo(() => {
    const r = [...(data ?? [])];
    const val = (c: CustomerRow): string => {
      if (sort.key === "name") return c.kana || c.name;
      if (sort.key === "status") return c.status;
      if (sort.key === "owner") return c.salesOwner ?? "";
      if (sort.key === "next") return c.nextAction?.due ?? "9999";
      if (sort.key.startsWith("custom:")) return c.custom[sort.key.slice(7)] ?? "";
      return c.updatedAt;
    };
    return r.sort((a, b) => val(a).localeCompare(val(b), "ja") * sort.dir);
  }, [data, sort]);

  const setF = (patch: Partial<CustomerFilter>) => setFilter({ ...filter, ...patch });
  const toggleCol = (k: ColKey) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k];
    setCols(next);
    try {
      localStorage.setItem("zelnora.customerColumns", JSON.stringify(next));
    } catch {
      // 無視
    }
  };

  const exportCsv = () => {
    const target = rows.filter((r) => !selected.size || selected.has(r.id));
    const head = ["ID", "氏名", "ふりがな", "メール", "電話", "会社名", "状態", "担当営業", "タグ", "流入経路", ...customFields.map((f) => f.label), "作成日"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = target.map((c) =>
      [c.id, c.name, c.kana, c.email, c.phone, c.company, CUSTOMER_STATUS_LABELS[c.status], s.userName(c.salesOwner), c.tags.join(" "), c.source, ...customFields.map((f) => c.custom[f.key] ?? ""), c.createdAt.slice(0, 10)].map((v) => esc(String(v ?? ""))).join(","),
    );
    downloadText(`customers-${new Date().toISOString().slice(0, 10)}.csv`, [head.join(","), ...lines].join("\r\n"));
  };

  const stageName = (productId: string, stageId: string) => s.product(productId)?.stages.find((x) => x.id === stageId)?.name ?? stageId;

  return (
    <>
      <PageHeader
        title={`${L.customer}一覧`}
        description={`全${L.product}の${L.customer}を1人1件で管理します。`}
        actions={
          <>
            {can(s.user, "customers.merge") && (
              <Link to="/customers/duplicates" className="text-sm font-semibold text-brand-700 hover:underline">
                重複の確認
              </Link>
            )}
            {can(s.user, "customers.edit") && <Button onClick={() => setShowCreate(true)}>＋ {L.customer}を登録</Button>}
          </>
        }
      />
      {msg && (
        <div className="mb-3">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Input placeholder="氏名・メール・電話・会社名" value={filter.q ?? ""} onChange={(e) => setF({ q: e.target.value })} aria-label="キーワード" className="xl:col-span-2" />
          <Select aria-label={L.product} value={filter.productId ?? ""} onChange={(e) => setF({ productId: e.target.value || undefined, stageId: undefined, planId: undefined })}>
            <option value="">{L.product}：すべて</option>
            {s.activeProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label={L.plan} value={filter.planId ?? ""} onChange={(e) => setF({ planId: e.target.value || undefined })}>
            <option value="">{L.plan}：すべて</option>
            {s.settings.plans
              .filter((p) => !filter.productId || p.productId === filter.productId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Select aria-label="状態" value={filter.status ?? ""} onChange={(e) => setF({ status: e.target.value as CustomerStatus })}>
            <option value="">状態：すべて</option>
            {Object.entries(CUSTOMER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select aria-label="段階" value={filter.stageId ?? ""} disabled={!product} onChange={(e) => setF({ stageId: e.target.value || undefined })}>
            <option value="">段階：{product ? "すべて" : `（${L.product}を選択）`}</option>
            {product?.stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </Select>
          <Select aria-label="担当" value={filter.owner ?? ""} onChange={(e) => setF({ owner: e.target.value || undefined })}>
            <option value="">担当：すべて</option>
            {s.users.filter((u) => u.active).map((u) => (
              <option key={u.email} value={u.email}>
                {u.name}
              </option>
            ))}
          </Select>
          <Input placeholder="タグ（空白区切り）" aria-label="タグ" value={(filter.tags ?? []).join(" ")} onChange={(e) => setF({ tags: e.target.value.split(/\s+/).filter(Boolean) })} />
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="登録日（から）" value={filter.from ?? ""} onChange={(e) => setF({ from: e.target.value || undefined })} />
            <span>〜</span>
            <Input type="date" aria-label="登録日（まで）" value={filter.to ?? ""} onChange={(e) => setF({ to: e.target.value || undefined })} />
          </div>
          {customFields.slice(0, 3).map((f) => (
            <Input key={f.key} placeholder={f.label} aria-label={f.label} value={filter.custom?.[f.key] ?? ""} onChange={(e) => setF({ custom: { ...filter.custom, [f.key]: e.target.value } })} />
          ))}
          <Select aria-label="条件の組み合わせ" value={filter.mode ?? "all"} onChange={(e) => setF({ mode: e.target.value as "all" | "any" })}>
            <option value="all">条件をすべて満たす</option>
            <option value="any">いずれかを満たす</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{rows.length}件</span>
          <Button size="sm" variant="ghost" onClick={() => setFilter({ mode: "all" })}>
            条件をクリア
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCols(!showCols)}>
            表示する列
          </Button>
          <SavedViews
            views={views.data ?? []}
            onApply={(v) => {
              setFilter(JSON.parse(v.filter) as CustomerFilter);
              if (v.columns.length) setCols(v.columns as ColKey[]);
            }}
            onSave={async (name, shared) => {
              await call("views.save", { view: { name, shared, screen: "customers", filter, columns: cols } });
              await views.reload();
            }}
            onDelete={async (id) => {
              await call("views.delete", { id });
              await views.reload();
            }}
          />
          {can(s.user, "csv.export") && (
            <Button size="sm" variant="secondary" onClick={exportCsv}>
              CSV出力{selected.size ? `（選択 ${selected.size}件）` : ""}
            </Button>
          )}
        </div>
        {showCols && (
          <div className="mt-2 flex flex-wrap gap-3 rounded-lg bg-slate-50 p-2 text-sm">
            {[...ALL_COLUMNS, ...customFields.map((f) => ({ key: `custom:${f.key}` as ColKey, label: f.label }))].map((c) => (
              <label key={c.key} className="flex items-center gap-1">
                <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
              </label>
            ))}
          </div>
        )}
        {selected.size > 0 && can(s.user, "customers.edit") && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm">
            <span className="font-semibold">{selected.size}件を選択中：</span>
            {can(s.user, "assign.change") && (
              <Button size="sm" variant="secondary" onClick={() => setBulk("owner")}>
                担当を変更
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setBulk("tags")}>
              タグを付ける
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulk("status")}>
              状態を変更
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              選択を解除
            </Button>
          </div>
        )}
      </Card>

      <Card>
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>該当する{L.customer}はいません</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="すべて選択"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  {cols.map((k) => {
                    const label = k.startsWith("custom:") ? customFields.find((f) => `custom:${f.key}` === k)?.label ?? k : ALL_COLUMNS.find((c) => c.key === k)?.label;
                    return (
                      <th key={k} className="cursor-pointer select-none px-3 py-2" onClick={() => setSort({ key: k, dir: sort.key === k ? ((-sort.dir) as 1 | -1) : 1 })}>
                        {label} {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={cx("cursor-pointer border-b border-slate-100 hover:bg-slate-50", selected.has(c.id) && "bg-brand-50")} onClick={() => nav(`/customers/${c.id}`)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${c.name}を選択`}
                        checked={selected.has(c.id)}
                        onChange={(e) => {
                          const n = new Set(selected);
                          if (e.target.checked) n.add(c.id);
                          else n.delete(c.id);
                          setSelected(n);
                        }}
                      />
                    </td>
                    {cols.map((k) => (
                      <td key={k} className="px-3 py-2 align-top">
                        {k === "name" && (
                          <>
                            <span className="font-semibold text-brand-700">{c.name}</span>
                            {c.kana && <span className="block text-xs text-slate-400">{c.kana}</span>}
                          </>
                        )}
                        {k === "status" && <Badge tone={c.status === "customer" ? "green" : c.status === "lead" ? "blue" : "slate"}>{CUSTOMER_STATUS_LABELS[c.status]}</Badge>}
                        {k === "email" && <span className="text-xs">{c.email}</span>}
                        {k === "phone" && <span className="text-xs">{c.phone}</span>}
                        {k === "company" && c.company}
                        {k === "products" &&
                          c.stages.map((st) => (
                            <span key={st.dealId} className="mr-1 inline-block text-xs">
                              {s.product(st.productId)?.name}：<b>{stageName(st.productId, st.stageId)}</b>
                            </span>
                          ))}
                        {k === "owner" && <span className="text-xs">{s.userName(c.salesOwner)}</span>}
                        {k === "next" && c.nextAction && (
                          <span className="text-xs">
                            <span className={c.nextAction.due < new Date().toISOString().slice(0, 10) ? "font-bold text-rose-700" : ""}>{c.nextAction.due.slice(5)}</span> {c.nextAction.title}
                          </span>
                        )}
                        {k === "tags" && c.tags.map((t) => <Badge key={t} className="mr-1">{t}</Badge>)}
                        {k === "source" && <span className="text-xs">{c.source}</span>}
                        {k === "updated" && <span className="text-xs tabular-nums">{c.updatedAt.slice(0, 10)}</span>}
                        {k.startsWith("custom:") && <span className="text-xs">{c.custom[k.slice(7)] ?? ""}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {showCreate && (
        <CreateCustomerDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            nav(`/customers/${id}`);
          }}
        />
      )}
      {bulk && (
        <BulkDialog
          mode={bulk}
          ids={[...selected]}
          onClose={() => setBulk(null)}
          onDone={(n) => {
            setBulk(null);
            setSelected(new Set());
            setMsg({ tone: "success", text: `${n}件を更新しました` });
            void reload();
          }}
        />
      )}
    </>
  );
}

function SavedViews({ views, onApply, onSave, onDelete }: { views: SavedView[]; onApply: (v: SavedView) => void; onSave: (name: string, shared: boolean) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Select
        aria-label="保存ビュー"
        className="w-auto py-1"
        value=""
        onChange={(e) => {
          const v = views.find((x) => x.id === e.target.value);
          if (v) onApply(v);
        }}
      >
        <option value="">保存ビュー（{views.length}）</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.shared ? "（共有）" : ""}
          </option>
        ))}
      </Select>
      {saving ? (
        <>
          <Input className="w-40 py-1" placeholder="ビューの名前" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            チームで共有
          </label>
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={async () => {
              await onSave(name, shared);
              setSaving(false);
              setName("");
            }}
          >
            保存
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSaving(true)}>
          今の条件を保存
        </Button>
      )}
      {views.length > 0 && (
        <Select
          aria-label="保存ビューの削除"
          className="w-auto py-1 text-xs"
          value=""
          onChange={(e) => e.target.value && confirm("このビューを削除しますか？") && void onDelete(e.target.value)}
        >
          <option value="">削除…</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      )}
    </span>
  );
}

function BulkDialog({ mode, ids, onClose, onDone }: { mode: "owner" | "tags" | "status"; ids: string[]; onClose: () => void; onDone: (n: number) => void }) {
  const [owner, setOwner] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState<CustomerStatus>("customer");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={mode === "owner" ? "担当営業を変更" : mode === "tags" ? "タグを付ける" : "状態を変更"}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              const patch = mode === "owner" ? { salesOwner: owner || null } : mode === "tags" ? { addTags: tags.split(/[\s,、]+/).filter(Boolean) } : { status };
              onDone(await call<number>("customers.bulk", { ids, patch }));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {ids.length}件に適用
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {mode === "owner" && <UserSelect value={owner} onChange={setOwner} roles={["sales", "manager", "admin", "owner"]} allowEmpty />}
      {mode === "tags" && <Input placeholder="タグ（空白区切り）" value={tags} onChange={(e) => setTags(e.target.value)} />}
      {mode === "status" && (
        <Select value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus)}>
          {Object.entries(CUSTOMER_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      )}
    </Modal>
  );
}

export function CreateCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const s = useSession();
  const [f, setF] = useState({ name: "", kana: "", email: "", phone: "", company: "", source: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={`${s.labels().customer}を登録`}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              const c = await call<{ id: string }>("customers.create", { customer: f });
              onCreated(c.id);
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="氏名" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="ふりがな">
          <Input value={f.kana} onChange={(e) => setF({ ...f, kana: e.target.value })} />
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
          <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
        </Field>
      </div>
      <Field label="メモ">
        <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </Modal>
  );
}
