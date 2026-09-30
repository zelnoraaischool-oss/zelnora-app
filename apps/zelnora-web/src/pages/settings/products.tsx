import { type FieldDef, type FieldType, type Product, type ProgressTemplate, type Recurrence, REVENUE_RULE_LABELS, type Stage, STAGE_KIND_LABELS, type StageKind } from "@zelnora/core";
import { useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "../../components/ui";
import { call } from "../../lib/api";
import { useSession } from "../../lib/session";

export const DICTIONARY_KEYS: [string, string][] = [
  ["customer", "顧客"],
  ["lead", "リード"],
  ["deal", "商談"],
  ["delivery", "提供"],
  ["deliveryOwner", "提供担当"],
  ["salesOwner", "営業担当"],
  ["progressItem", "進捗項目"],
  ["registration", "登録"],
  ["plan", "プラン"],
];

export function ProductsSettings() {
  const s = useSession();
  const [editing, setEditing] = useState<Product | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (editing) {
    return (
      <ProductEditor
        product={editing}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          setMsg({ tone: "success", text: "保存しました（新しい版として記録しました）" });
          await s.reload();
        }}
      />
    );
  }
  return (
    <Card>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <ul className="divide-y divide-slate-100">
        {s.settings.products.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <span className="font-semibold">{p.name}</span>
              <span className="ml-2 text-xs text-slate-500">{s.templates.find((t) => t.templateType === p.templateType)?.label}</span>
              {p.status === "stopped" && <Badge tone="red" className="ml-2">停止中</Badge>}
              <div className="text-xs text-slate-500">
                段階 {p.stages.length}・計上 {REVENUE_RULE_LABELS[p.revenueRule]}・プラン {s.settings.plans.filter((x) => x.productId === p.id).length}件
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                編集
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await call("settings.setProductStatus", { id: p.id, status: p.status === "active" ? "stopped" : "active" });
                    await s.reload();
                  } catch (e) {
                    setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                {p.status === "active" ? "停止する" : "再開する"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {s.settings.products.length === 0 && <p className="py-6 text-center text-sm text-slate-500">まだ商材がありません。「設定ウィザード」から追加してください。</p>}
      <p className="mt-2 text-xs text-slate-500">停止した商材のデータは閲覧のみできます。</p>
    </Card>
  );
}

export function ProductEditor({ product, onCancel, onSaved, saveLabel = "保存", embedded }: { product: Product; onCancel?: () => void; onSaved: (p: Product) => void | Promise<void>; saveLabel?: string; embedded?: boolean }) {
  const s = useSession();
  const [p, setP] = useState<Product>(product);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const users = s.users.filter((u) => u.active);
  const save = async () => {
    setBusy(true);
    try {
      await call("settings.saveProduct", { product: p });
      await onSaved(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Card title="基本">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="商材名" required>
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </Field>
          <Field label="売上の計上ルール（既定）">
            <Select value={p.revenueRule} onChange={(e) => setP({ ...p, revenueRule: e.target.value as Product["revenueRule"] })}>
              {Object.entries(REVENUE_RULE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="計上の基準日" hint="経理・税理士と確認のうえ決めてください（Q-03）">
            <Select value={p.revenueBasis} onChange={(e) => setP({ ...p, revenueBasis: e.target.value as Product["revenueBasis"] })}>
              <option value="contract">契約日</option>
              <option value="payment">入金日</option>
              <option value="delivery_start">提供開始日</option>
            </Select>
          </Field>
          <Field label="提供の開始日">
            <Select value={p.deliveryStartBasis} onChange={(e) => setP({ ...p, deliveryStartBasis: e.target.value as Product["deliveryStartBasis"] })}>
              <option value="registration">登録日</option>
              <option value="first_session">初回の予定日</option>
            </Select>
          </Field>
          <Field label="営業担当の割り当て">
            <Select value={p.salesAssignment} onChange={(e) => setP({ ...p, salesAssignment: e.target.value as Product["salesAssignment"] })}>
              <option value="manual">手動</option>
              <option value="round_robin">順番に割り当て</option>
              <option value="default">既定の担当者</option>
            </Select>
          </Field>
          <Field label="既定の営業担当">
            <Select value={p.defaultSalesOwner ?? ""} onChange={(e) => setP({ ...p, defaultSalesOwner: e.target.value || null })}>
              <option value="">なし</option>
              {users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="提供担当の割り当て">
            <Select value={p.deliveryAssignment} onChange={(e) => setP({ ...p, deliveryAssignment: e.target.value as Product["deliveryAssignment"] })}>
              <option value="manual">手動</option>
              <option value="least_loaded">担当数が少ない人から</option>
              <option value="default">既定の担当者</option>
            </Select>
          </Field>
          <Field label="既定の提供担当">
            <Select value={p.defaultDeliveryOwner ?? ""} onChange={(e) => setP({ ...p, defaultDeliveryOwner: e.target.value || null })}>
              <option value="">なし</option>
              {users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="呼び名の辞書">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {DICTIONARY_KEYS.map(([k, d]) => (
            <Field key={k} label={`${d} →`}>
              <Input placeholder={d} value={p.dictionary[k] ?? ""} onChange={(e) => setP({ ...p, dictionary: { ...p.dictionary, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </Card>
      <StagesEditor stages={p.stages} fields={p.customFields.deal} onChange={(stages) => setP({ ...p, stages })} />
      <ProgressTemplatesEditor templates={p.progressTemplates} onChange={(progressTemplates) => setP({ ...p, progressTemplates })} />
      <Card title="追加項目">
        {(["customer", "deal", "delivery"] as const).map((scope) => (
          <FieldsEditor
            key={scope}
            title={{ customer: "顧客", deal: "商談（段階の必須項目にも使えます）", delivery: "提供" }[scope]}
            fields={p.customFields[scope]}
            onChange={(f) => setP({ ...p, customFields: { ...p.customFields, [scope]: f } })}
          />
        ))}
      </Card>
      <Card title="その他">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="失注理由の選択肢（改行区切り）">
            <Textarea rows={4} value={p.lostReasons.join("\n")} onChange={(e) => setP({ ...p, lostReasons: e.target.value.split("\n").filter(Boolean) })} />
          </Field>
          <Field label="活動記録のよく使う文面（「見出し｜本文」を改行区切り）">
            <Textarea
              rows={4}
              value={p.activityTemplates.map((t) => `${t.title}｜${t.body}`).join("\n")}
              onChange={(e) =>
                setP({
                  ...p,
                  activityTemplates: e.target.value
                    .split("\n")
                    .filter(Boolean)
                    .map((l) => {
                      const [title, ...rest] = l.split("｜");
                      return { title: title ?? "", body: rest.join("｜") };
                    }),
                })
              }
            />
          </Field>
        </div>
      </Card>
      {!embedded && (
        <div className="flex gap-2">
          <Button disabled={busy} onClick={save}>
            {saveLabel}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              キャンセル
            </Button>
          )}
        </div>
      )}
      {embedded && (
        <Button disabled={busy} onClick={save}>
          {saveLabel}
        </Button>
      )}
    </div>
  );
}

const TOP_FIELDS: [string, string][] = [
  ["planId", "プラン"],
  ["amount", "金額"],
  ["paymentMethod", "支払い方法"],
];

export function StagesEditor({ stages, fields, onChange }: { stages: Stage[]; fields: FieldDef[]; onChange: (s: Stage[]) => void }) {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const upd = (id: string, patch: Partial<Stage>) => onChange(stages.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const options = [...TOP_FIELDS, ...fields.map((f) => [f.key, f.label] as [string, string])];
  return (
    <Card
      title="営業の段階"
      actions={
        <Button size="sm" variant="secondary" onClick={() => onChange([...stages, { id: `st${Date.now().toString(36)}`, name: "新しい段階", kind: "contact", order: Math.max(0, ...stages.filter((x) => x.order < 90).map((x) => x.order)) + 1, requiredFields: [], defaultNextAction: { title: "", days: 3 }, staleDays: 14, probability: 20 }])}>
          ＋ 段階を追加
        </Button>
      }
    >
      <p className="mb-2 text-xs text-slate-500">自動処理は段階の「種類」に結び付きます（例：種類が「成約」の段階に進むと、売上予定と登録フォームの案内を作ります）。</p>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-2 py-1">順</th>
              <th className="px-2 py-1">名前</th>
              <th className="px-2 py-1">種類</th>
              <th className="px-2 py-1">移動時の必須項目</th>
              <th className="px-2 py-1">次のアクションの初期値</th>
              <th className="px-2 py-1">基準日数</th>
              <th className="px-2 py-1">確度%</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((st, i) => (
              <tr key={st.id} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1">
                  <div className="flex flex-col">
                    <button type="button" aria-label="上へ" className="text-xs text-slate-500 disabled:opacity-30" disabled={i === 0} onClick={() => { const prev = sorted[i - 1]!; onChange(stages.map((x) => (x.id === st.id ? { ...x, order: prev.order } : x.id === prev.id ? { ...x, order: st.order } : x))); }}>
                      ▲
                    </button>
                    <button type="button" aria-label="下へ" className="text-xs text-slate-500 disabled:opacity-30" disabled={i === sorted.length - 1} onClick={() => { const next = sorted[i + 1]!; onChange(stages.map((x) => (x.id === st.id ? { ...x, order: next.order } : x.id === next.id ? { ...x, order: st.order } : x))); }}>
                      ▼
                    </button>
                  </div>
                </td>
                <td className="px-2 py-1">
                  <Input aria-label="段階の名前" value={st.name} onChange={(e) => upd(st.id, { name: e.target.value })} />
                </td>
                <td className="px-2 py-1">
                  <Select aria-label="種類" value={st.kind} onChange={(e) => upd(st.id, { kind: e.target.value as StageKind })}>
                    {Object.entries(STAGE_KIND_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-x-2 text-xs">
                    {options.map(([k, l]) => (
                      <label key={k} className="flex items-center gap-1">
                        <input type="checkbox" checked={st.requiredFields.includes(k)} onChange={(e) => upd(st.id, { requiredFields: e.target.checked ? [...st.requiredFields, k] : st.requiredFields.filter((x) => x !== k) })} />
                        {l}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-1">
                  <div className="flex gap-1">
                    <Input aria-label="次のアクション" placeholder="内容" value={st.defaultNextAction?.title ?? ""} onChange={(e) => upd(st.id, { defaultNextAction: e.target.value ? { title: e.target.value, days: st.defaultNextAction?.days ?? 3, fromField: st.defaultNextAction?.fromField } : null })} />
                    <Input aria-label="何日後" className="w-16" type="number" value={st.defaultNextAction?.days ?? ""} onChange={(e) => st.defaultNextAction && upd(st.id, { defaultNextAction: { ...st.defaultNextAction, days: Number(e.target.value) } })} />
                  </div>
                </td>
                <td className="px-2 py-1">
                  <Input aria-label="基準日数" className="w-16" type="number" value={st.staleDays ?? ""} onChange={(e) => upd(st.id, { staleDays: e.target.value ? Number(e.target.value) : null })} />
                </td>
                <td className="px-2 py-1">
                  <Input aria-label="確度" className="w-16" type="number" value={st.probability ?? ""} onChange={(e) => upd(st.id, { probability: Number(e.target.value) })} />
                </td>
                <td className="px-2 py-1">
                  <Button size="sm" variant="ghost" onClick={() => onChange(stages.filter((x) => x.id !== st.id))}>
                    削除
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ProgressTemplatesEditor({ templates, onChange }: { templates: ProgressTemplate[]; onChange: (t: ProgressTemplate[]) => void }) {
  const upd = (ti: number, t: ProgressTemplate) => onChange(templates.map((x, i) => (i === ti ? t : x)));
  return (
    <Card
      title="提供の進め方（進捗テンプレート）"
      actions={
        <Button size="sm" variant="secondary" onClick={() => onChange([...templates, { id: `pt${Date.now().toString(36)}`, name: "新しいテンプレート", items: [] }])}>
          ＋ テンプレートを追加
        </Button>
      }
    >
      {templates.map((t, ti) => (
        <div key={t.id} className="mb-4 rounded-lg p-3 ring-1 ring-slate-200">
          <div className="mb-2 flex gap-2">
            <Input aria-label="テンプレート名" value={t.name} onChange={(e) => upd(ti, { ...t, name: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => onChange(templates.filter((_, i) => i !== ti))}>
              削除
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">項目名</th>
                <th className="py-1">起点</th>
                <th className="py-1">日数</th>
                <th className="py-1">繰り返し</th>
                <th className="py-1">繰り返しの名前（{"{n}"}＝回数）</th>
                <th className="py-1">完了の条件</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.items.map((it, ii) => {
                const set = (patch: Partial<typeof it>) => upd(ti, { ...t, items: t.items.map((x, j) => (j === ii ? { ...x, ...patch } : x)) });
                return (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="py-1 pr-1">
                      <Input aria-label="項目名" value={it.name} onChange={(e) => set({ name: e.target.value })} />
                    </td>
                    <td className="py-1 pr-1">
                      <Select aria-label="起点" value={it.anchor} onChange={(e) => set({ anchor: e.target.value as typeof it.anchor })}>
                        <option value="start">開始日から</option>
                        <option value="previous">前の項目から</option>
                        <option value="end">終了日から</option>
                      </Select>
                    </td>
                    <td className="py-1 pr-1">
                      <Input aria-label="日数" className="w-16" type="number" value={it.offsetDays} onChange={(e) => set({ offsetDays: Number(e.target.value) })} />
                    </td>
                    <td className="py-1 pr-1">
                      <Select aria-label="繰り返し" value={it.repeat} onChange={(e) => set({ repeat: e.target.value as Recurrence })}>
                        <option value="none">なし</option>
                        <option value="weekly">毎週（終了日まで）</option>
                        <option value="biweekly">隔週（終了日まで）</option>
                        <option value="monthly">毎月（終了日まで）</option>
                      </Select>
                    </td>
                    <td className="py-1 pr-1">
                      <div className="flex gap-1">
                        <Input aria-label="繰り返しの名前" disabled={it.repeat === "none"} value={it.repeatName ?? ""} onChange={(e) => set({ repeatName: e.target.value })} />
                        <Input aria-label="数え始め" className="w-14" type="number" disabled={it.repeat === "none"} value={it.repeatStartNumber ?? 1} onChange={(e) => set({ repeatStartNumber: Number(e.target.value) })} />
                      </div>
                    </td>
                    <td className="py-1 pr-1">
                      <Select aria-label="完了の条件" value={it.completion} onChange={(e) => set({ completion: e.target.value as typeof it.completion })}>
                        <option value="session">記録を残す</option>
                        <option value="date">日付を決める</option>
                        <option value="check">確認する</option>
                      </Select>
                    </td>
                    <td className="py-1">
                      <Button size="sm" variant="ghost" onClick={() => upd(ti, { ...t, items: t.items.filter((_, j) => j !== ii) })}>
                        削除
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => upd(ti, { ...t, items: [...t.items, { id: `it${Date.now().toString(36)}`, name: "", anchor: "previous", offsetDays: 7, repeat: "none", completion: "session" }] })}>
            ＋ 項目を追加
          </Button>
        </div>
      ))}
    </Card>
  );
}

export function FieldsEditor({ title, fields, onChange }: { title: string; fields: FieldDef[]; onChange: (f: FieldDef[]) => void }) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-semibold text-slate-600">{title}</p>
      {fields.map((f, i) => {
        const set = (patch: Partial<FieldDef>) => onChange(fields.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="mb-1 grid gap-1 sm:grid-cols-[8rem_1fr_8rem_1fr_auto_auto]">
            <Input aria-label="キー" placeholder="キー（英数字）" value={f.key} onChange={(e) => set({ key: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} />
            <Input aria-label="表示名" placeholder="表示名" value={f.label} onChange={(e) => set({ label: e.target.value })} />
            <Select aria-label="種類" value={f.type} onChange={(e) => set({ type: e.target.value as FieldType })}>
              <option value="text">文字</option>
              <option value="textarea">長文</option>
              <option value="number">数値</option>
              <option value="date">日付</option>
              <option value="datetime">日時</option>
              <option value="select">選択肢</option>
            </Select>
            <Input aria-label="選択肢" placeholder="選択肢（、区切り）" disabled={f.type !== "select"} value={(f.options ?? []).join("、")} onChange={(e) => set({ options: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} />
            <label className="flex items-center gap-1 text-xs whitespace-nowrap">
              <input type="checkbox" checked={(f.hiddenFromRoles ?? []).includes("viewer")} onChange={(e) => set({ hiddenFromRoles: e.target.checked ? ["viewer"] : [] })} />
              閲覧者に見せない
            </label>
            <Button size="sm" variant="ghost" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              削除
            </Button>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => onChange([...fields, { key: `f${fields.length + 1}`, label: "", type: "text" }])}>
        ＋ 項目を追加
      </Button>
    </div>
  );
}
