import type { FormMapping } from "@zelnora/core";
import { useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select } from "../../components/ui";
import { call, useApi } from "../../lib/api";
import { useSession } from "../../lib/session";

type Inspect = { id: string; title: string; publishedUrl: string; destinationId: string; items: { id: string; title: string; type: string }[] };

export const TARGETS: [string, string][] = [
  ["", "（取り込まない）"],
  ["customer.name", "顧客：氏名"],
  ["customer.kana", "顧客：ふりがな"],
  ["customer.email", "顧客：メール"],
  ["customer.phone", "顧客：電話"],
  ["customer.company", "顧客：会社名"],
];

export function FormsSettings() {
  const s = useSession();
  const [editing, setEditing] = useState<FormMapping | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const logs = useApi<{ id: string; at: string; result: string; message: string; attempts: number }[]>("imports.list");
  return (
    <div className="space-y-4">
      {msg && <Alert tone="success">{msg}</Alert>}
      <Card
        title="登録フォームの対応付け"
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={async () => { const r = await call<{ installed: number }>("forms.installTriggers"); setMsg(`送信トリガーを ${r.installed} 件追加しました`); }}>
              送信トリガーを設定
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setEditing({ id: "", productId: s.settings.products[0]?.id ?? "", planId: "", name: "", responseSpreadsheetId: "", responseSheetName: "", mapping: {}, matchBy: ["email", "phone"], actions: { advanceStage: true, createDelivery: true, notify: true }, active: true })
              }
            >
              ＋ フォームを追加
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-slate-500">質問と項目の対応は、質問文ではなくフォームの質問ID（item ID）で持ちます。質問文を直しても取り込みは壊れません。</p>
        <ul className="divide-y divide-slate-100">
          {s.settings.forms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-semibold">{f.name}</span> {f.purpose === "lead" && <Badge tone="blue">問い合わせ</Badge>} {f.active ? <Badge tone="green">有効</Badge> : <Badge>停止</Badge>}
                <div className="text-xs text-slate-500">
                  {s.product(f.productId)?.name} ／ {s.settings.plans.find((p) => p.id === f.planId)?.name} ／ 対応 {Object.values(f.mapping).filter(Boolean).length}項目
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
                編集
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="取り込みログ（新しい順）">
        <table className="w-full text-sm">
          <tbody>
            {(logs.data ?? []).slice(0, 50).map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1 text-xs tabular-nums">{l.at.slice(0, 16).replace("T", " ")}</td>
                <td className="py-1">{l.result === "ok" ? <Badge tone="green">成功</Badge> : l.result === "pending" ? <Badge tone="amber">確認待ち</Badge> : <Badge tone="red">失敗（{l.attempts}回）</Badge>}</td>
                <td className="py-1 text-xs">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!logs.data?.length && <p className="py-4 text-center text-sm text-slate-500">まだありません</p>}
      </Card>
      {editing && <FormEditor form={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await s.reload(); }} />}
    </div>
  );
}

export function FormEditor({ form, onClose, onSaved, inline }: { form: FormMapping; onClose: () => void; onSaved: (f: FormMapping) => void; inline?: boolean }) {
  const s = useSession();
  const [f, setF] = useState<FormMapping>(form);
  const [items, setItems] = useState<Inspect["items"]>(() => Object.keys(form.mapping).map((id) => ({ id, title: id, type: "" })));
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const product = s.product(f.productId);
  const targets = [
    ...TARGETS,
    ...(product?.customFields.customer ?? []).map((c) => [`customer.custom.${c.key}`, `顧客：${c.label}`] as [string, string]),
    ...(product?.customFields.delivery ?? []).map((c) => [`delivery.fields.${c.key}`, `提供：${c.label}`] as [string, string]),
    ...(product?.customFields.deal ?? []).map((c) => [`deal.fields.${c.key}`, `商談：${c.label}`] as [string, string]),
  ];
  const inspect = async () => {
    try {
      const r = await call<Inspect>("forms.inspect", { formId: f.id });
      setItems(r.items);
      setF({ ...f, name: f.name || r.title, publishedUrl: r.publishedUrl, responseSpreadsheetId: f.responseSpreadsheetId || r.destinationId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const body = (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="GoogleフォームのID" hint="フォームの編集画面のURL（/forms/d/ここ/edit）の部分。システムアカウントを編集者に追加してください">
          <div className="flex gap-1">
            <Input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.trim().replace(/^.*\/forms\/d\/([^/]+).*$/, "$1") })} />
            <Button variant="secondary" onClick={inspect} disabled={!f.id}>
              質問を読み込む
            </Button>
          </div>
        </Field>
        <Field label="名前">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={s.labels().product}>
          <Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value, planId: "" })}>
            {s.settings.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="用途">
          <Select value={f.purpose ?? "registration"} onChange={(e) => setF({ ...f, purpose: e.target.value as FormMapping["purpose"] })}>
            <option value="registration">登録フォーム（契約後に提供を作る）</option>
            <option value="lead">問い合わせフォーム（リードとして登録する）</option>
          </Select>
        </Field>
        <Field label={s.labels().plan} required={f.purpose !== "lead"}>
          <Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">{f.purpose === "lead" ? "未定" : "選択してください"}</option>
            {s.settings.plans
              .filter((p) => p.productId === f.productId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="回答先のスプレッドシートID（プランのタブ）">
          <Input value={f.responseSpreadsheetId} onChange={(e) => setF({ ...f, responseSpreadsheetId: e.target.value })} />
        </Field>
        <Field label="回答先のタブ名">
          <Input value={f.responseSheetName} onChange={(e) => setF({ ...f, responseSheetName: e.target.value })} />
        </Field>
      </div>
      <p className="text-sm font-semibold">質問と項目の対応</p>
      {items.length === 0 && <p className="text-xs text-slate-500">「質問を読み込む」を押すと、フォームの質問が表示されます。</p>}
      <table className="w-full text-sm">
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-slate-100">
              <td className="py-1">
                {it.title}
                <span className="ml-1 font-mono text-[11px] text-slate-400">#{it.id}</span>
              </td>
              <td className="py-1">
                <Select aria-label={`${it.title}の対応先`} value={f.mapping[it.id] ?? ""} onChange={(e) => setF({ ...f, mapping: { ...f.mapping, [it.id]: e.target.value } })}>
                  {targets.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="py-1 pl-2">
                <Input aria-label={`${it.title}のテスト回答`} placeholder="テスト回答" value={test[it.id] ?? ""} onChange={(e) => setTest({ ...test, [it.id]: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="同じ人の判定に使う項目">
          <div className="flex gap-3 text-sm">
            {(["email", "phone"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={f.matchBy.includes(k)} onChange={(e) => setF({ ...f, matchBy: e.target.checked ? [...f.matchBy, k] : f.matchBy.filter((x) => x !== k) })} />
                {k === "email" ? "メール" : "電話"}
              </label>
            ))}
          </div>
        </Field>
        <Field label="取り込み後の処理">
          <div className="flex flex-wrap gap-3 text-sm">
            {([
              ["advanceStage", "段階を進める"],
              ["createDelivery", "提供を作る"],
              ["notify", "知らせる"],
            ] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={f.actions[k]} onChange={(e) => setF({ ...f, actions: { ...f.actions, [k]: e.target.checked } })} />
                {l}
              </label>
            ))}
          </div>
        </Field>
        <Field label="事前入力：氏名の質問">
          <Select value={f.prefillQuestions?.name ?? ""} onChange={(e) => setF({ ...f, prefillQuestions: { ...f.prefillQuestions, name: e.target.value || undefined } })}>
            <option value="">なし</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="事前入力：メールの質問">
          <Select value={f.prefillQuestions?.email ?? ""} onChange={(e) => setF({ ...f, prefillQuestions: { ...f.prefillQuestions, email: e.target.value || undefined } })}>
            <option value="">なし</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> 取り込みを有効にする
      </label>
      {testResult && <Alert tone={testResult.startsWith("失敗") ? "error" : "info"}>{testResult}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!f.id || (f.purpose !== "lead" && !f.planId)}
          onClick={async () => {
            try {
              const r = await call<{ ok: boolean; error?: string; result?: { status: string; message: string }; changes: { entity: string }[] }>("registrations.testImport", {
                payload: { formId: f.id, responseId: `test-${Date.now()}`, submittedAt: new Date().toISOString(), answers: test },
                form: f,
              });
              setTestResult(
                r.ok
                  ? `結果：${r.result?.status}（${r.result?.message}）\n作られる・変わるデータ：${Object.entries(r.changes.reduce<Record<string, number>>((a, c) => ({ ...a, [c.entity]: (a[c.entity] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}件`).join("、")}\n※テストなので実際のデータは変わっていません`
                  : `失敗：${r.error}`,
              );
            } catch (e) {
              setTestResult(`失敗：${e instanceof Error ? e.message : String(e)}`);
            }
          }}
        >
          テスト取り込み（データは変えない）
        </Button>
        {inline && (
          <Button
            onClick={async () => {
              try {
                await call("settings.saveForm", { form: f });
                onSaved(f);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            保存
          </Button>
        )}
      </div>
    </>
  );
  if (inline) return <div className="space-y-3">{body}</div>;
  return (
    <Modal
      open
      wide
      title={form.id ? `フォーム：${form.name}` : "フォームを追加"}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              if (!f.id) throw new Error("フォームIDを入力してください");
              await call("settings.saveForm", { form: f });
              onSaved(f);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存
        </Button>
      }
    >
      {body}
    </Modal>
  );
}
