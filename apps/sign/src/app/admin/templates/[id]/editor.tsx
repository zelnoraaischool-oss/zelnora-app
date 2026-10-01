"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ContractBody } from "@/components/contract-body";
import { type ClauseOption, RichEditor } from "@/components/editor/rich-editor";
import { Alert, Badge, Button, Card, cx, Field, Input, Select, Textarea } from "@/components/ui";
import {
  documentToPlainText,
  collectVariableKeys,
  CONFIRM_ITEMS,
  type ConfirmItemKey,
  type ConfirmScreenItems,
  type DocNode,
  type KeyClause,
  resolveDocument,
} from "@/lib/contract/document";
import { formatValue, isValidVariableKey, sampleValue, SYSTEM_VARIABLES, VARIABLE_TYPES, type VariableDef, type VariableType } from "@/lib/contract/variables";
import { formatJst } from "@/lib/format";
import type { TemplateRow, TemplateVersionRow } from "@/lib/server/types";
import { WordImport } from "./word-import";
import { archiveTemplateAction, duplicateTemplateAction, publishAction, saveDraftAction, startNewVersionAction } from "../../actions";

type Tab = "body" | "variables" | "confirm" | "key" | "email" | "search" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "本文" },
  { id: "variables", label: "変数" },
  { id: "confirm", label: "最終確認画面" },
  { id: "key", label: "重要条項" },
  { id: "email", label: "メール文面" },
  { id: "search", label: "検索項目" },
  { id: "history", label: "版の履歴" },
];

interface VersionSummary {
  id: string;
  version_no: number;
  published_at: string | null;
  body_hash: string | null;
  created_at: string;
}

export function TemplateEditor({
  template,
  draft,
  current,
  versions,
  clauses,
  canEdit,
}: {
  template: TemplateRow;
  draft: TemplateVersionRow | null;
  current: TemplateVersionRow | null;
  versions: VersionSummary[];
  clauses: ClauseOption[];
  canEdit: boolean;
}) {
  const base = draft ?? current!;
  const editable = canEdit && !!draft;
  const [tab, setTab] = useState<Tab>("body");
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [body, setBody] = useState<DocNode>(base.body);
  const [variables, setVariables] = useState<VariableDef[]>(base.variables);
  const [confirm, setConfirm] = useState<ConfirmScreenItems>(base.confirm_screen_items);
  const [keyClauses, setKeyClauses] = useState<KeyClause[]>(base.key_clauses);
  const [emailSubject, setEmailSubject] = useState(base.email_subject);
  const [emailBody, setEmailBody] = useState(base.email_body);
  const [amountKey, setAmountKey] = useState(base.amount_variable_key ?? "");
  const [dateKey, setDateKey] = useState(base.transaction_date_variable_key ?? "");
  const [cpKey, setCpKey] = useState(base.counterparty_variable_key ?? "");
  const [saveState, setSaveState] = useState<{ saving: boolean; savedAt?: string; error?: string }>({ saving: false });
  const [publishMsg, setPublishMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [editorKey, setEditorKey] = useState(0);
  const dirty = useRef(false);

  const payload = useMemo(
    () => ({
      name,
      description,
      body,
      variables,
      confirm_screen_items: confirm,
      key_clauses: keyClauses,
      email_subject: emailSubject,
      email_body: emailBody,
      amount_variable_key: amountKey || null,
      transaction_date_variable_key: dateKey || null,
      counterparty_variable_key: cpKey || null,
    }),
    [name, description, body, variables, confirm, keyClauses, emailSubject, emailBody, amountKey, dateKey, cpKey],
  );

  const save = useCallback(async () => {
    if (!editable) return true;
    setSaveState({ saving: true });
    const r = await saveDraftAction(template.id, payload);
    if (r.ok) {
      dirty.current = false;
      setSaveState({ saving: false, savedAt: r.savedAt });
      return true;
    }
    setSaveState({ saving: false, error: r.error });
    return false;
  }, [editable, payload, template.id]);

  // 自動保存（入力が止まって1.5秒後）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!editable) return;
    dirty.current = true;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [payload, editable, save]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const variableKeys = useMemo(() => [...variables.map((v) => v.key), ...SYSTEM_VARIABLES], [variables]);
  const usedKeys = useMemo(() => collectVariableKeys(body), [body]);
  const undefinedKeys = usedKeys.filter((k) => !variableKeys.includes(k));

  const publish = () =>
    start(async () => {
      if (!(await save())) return;
      const r = await publishAction(template.id);
      setPublishMsg(
        r.ok
          ? { tone: "success", text: `第${r.versionNo}版を公開しました。以後この版は編集できません。` }
          : { tone: "error", text: r.error },
      );
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Input
            aria-label="テンプレート名"
            className="text-lg font-bold"
            value={name}
            disabled={!editable}
            onChange={(e) => setName(e.target.value)}
          />
          <Input aria-label="説明" placeholder="説明（任意）" value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {draft ? <Badge tone="amber">下書き（第{draft.version_no}版）</Badge> : <Badge tone="green">公開中（第{current?.version_no}版）</Badge>}
            {current && draft && <span className="text-xs text-slate-500">公開中の版：第{current.version_no}版</span>}
            {template.status === "archived" && <Badge tone="red">アーカイブ済み</Badge>}
            {editable && (
              <span className="text-xs text-slate-500">
                {saveState.saving ? "保存中…" : saveState.error ? <span className="text-rose-600">{saveState.error}</span> : saveState.savedAt ? `保存済み ${formatJst(saveState.savedAt, { seconds: true })}` : "変更は自動で保存されます"}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button onClick={publish} disabled={pending}>
              {pending ? "公開中…" : "この内容で公開"}
            </Button>
          )}
          {canEdit && !draft && (
            <form action={startNewVersionAction.bind(null, template.id)}>
              <Button type="submit">新しい版を作成して編集</Button>
            </form>
          )}
          {current && template.status === "active" && (
            <Link href={`/admin/contracts/new?template=${template.id}`} className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-brand-700 ring-1 ring-brand-600">
              この雛形で契約を作成
            </Link>
          )}
          {canEdit && (
            <form action={duplicateTemplateAction.bind(null, template.id)}>
              <Button variant="secondary" type="submit">複製</Button>
            </form>
          )}
          {canEdit && (
            <form action={archiveTemplateAction.bind(null, template.id, template.status === "active")}>
              <Button variant="ghost" type="submit">{template.status === "active" ? "アーカイブ" : "復元"}</Button>
            </form>
          )}
        </div>
      </div>
      {!editable && canEdit && current && (
        <Alert tone="info">公開済みの版は編集できません。内容を変えるには「新しい版を作成して編集」を押してください（既存の契約には影響しません）。</Alert>
      )}
      {!canEdit && <Alert tone="info">スタッフはテンプレートを閲覧のみできます。</Alert>}
      {publishMsg && <Alert tone={publishMsg.tone}>{publishMsg.text}</Alert>}
      {undefinedKeys.length > 0 && (
        <Alert tone="warning">未定義の変数が本文にあります：{undefinedKeys.join("、")}（「変数」タブで追加してください）</Alert>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold",
              tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "body" && editable && (
        <WordImport
          hasContent={documentToPlainText(body).trim() !== ""}
          onImported={(r) => {
            setBody(r.doc);
            setEditorKey((k) => k + 1);
            const known = new Set<string>([...variables.map((v) => v.key), ...SYSTEM_VARIABLES]);
            const added = r.variableKeys.filter((k) => !known.has(k) && isValidVariableKey(k));
            if (added.length) {
              setVariables((vs) => [...vs, ...added.map((key): VariableDef => ({ key, type: "text", filledBy: "admin", required: true }))]);
            }
            if (r.title && !name.trim()) setName(r.title);
            return [
              `読み込みました（条 ${r.articleCount} 件）。`,
              added.length ? `変数を ${added.length} 件追加しました：${added.join("、")}（「変数」タブで種類と入力者を確認してください）。` : "",
              "表や書式の崩れがないか、プレビューで確認してください。",
              ...r.warnings,
            ].filter(Boolean).join("\n");
          }}
        />
      )}
      {tab === "body" && (
        <BodyTab key={editorKey} title={name} body={body} setBody={setBody} variables={variables} variableKeys={variableKeys} clauses={clauses} editable={editable} />
      )}
      {tab === "variables" && <VariablesTab variables={variables} setVariables={setVariables} usedKeys={usedKeys} editable={editable} />}
      {tab === "confirm" && (
        <Card title="最終確認画面に表示する項目（特定商取引法）">
          <p className="mb-3 text-sm text-slate-600">
            署名直前の確認画面に表示します。{"{{変数名}}"} を使うと契約ごとの値に置き換わります。空欄の項目は表示しません。
          </p>
          <div className="space-y-3">
            {(Object.keys(CONFIRM_ITEMS) as ConfirmItemKey[]).map((k) => (
              <Field key={k} label={CONFIRM_ITEMS[k]}>
                <Textarea rows={2} value={confirm[k] ?? ""} disabled={!editable} onChange={(e) => setConfirm({ ...confirm, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </Card>
      )}
      {tab === "key" && <KeyClausesTab items={keyClauses} setItems={setKeyClauses} editable={editable} />}
      {tab === "email" && (
        <Card title="送付メールの文面">
          <p className="mb-3 text-sm text-slate-600">
            使える差し込み：{"{{契約名}} {{署名者氏名}} {{署名URL}} {{有効期限}} {{発注者名}}"} と、テンプレートの変数。本文を空にすると標準の文面になります。
          </p>
          <div className="space-y-3">
            <Field label="件名">
              <Input value={emailSubject} disabled={!editable} onChange={(e) => setEmailSubject(e.target.value)} />
            </Field>
            <Field label="本文" hint="{{署名URL}} を含めない場合は末尾に自動で追加します">
              <Textarea rows={10} value={emailBody} disabled={!editable} onChange={(e) => setEmailBody(e.target.value)} />
            </Field>
          </div>
        </Card>
      )}
      {tab === "search" && (
        <Card title="検索項目（電子帳簿保存法）">
          <p className="mb-3 text-sm text-slate-600">どの変数が「金額」「取引年月日」「取引先」にあたるかを指定します。契約一覧の検索に使われます。</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="金額">
              <Select value={amountKey} disabled={!editable} onChange={(e) => setAmountKey(e.target.value)}>
                <option value="">（指定なし）</option>
                {variables.filter((v) => v.type === "money" || v.type === "number").map((v) => <option key={v.key}>{v.key}</option>)}
              </Select>
            </Field>
            <Field label="取引年月日">
              <Select value={dateKey} disabled={!editable} onChange={(e) => setDateKey(e.target.value)}>
                <option value="">（指定なし）</option>
                {variables.filter((v) => v.type === "date").map((v) => <option key={v.key}>{v.key}</option>)}
              </Select>
            </Field>
            <Field label="取引先" hint="未指定の場合は署名者の会社名または氏名">
              <Select value={cpKey} disabled={!editable} onChange={(e) => setCpKey(e.target.value)}>
                <option value="">（署名者の会社名・氏名）</option>
                {variables.filter((v) => v.type === "text").map((v) => <option key={v.key}>{v.key}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
      )}
      {tab === "history" && (
        <Card title="版の履歴">
          <ul className="divide-y divide-slate-100 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">第{v.version_no}版</span>
                  {v.published_at ? <Badge tone="green">公開 {formatJst(v.published_at)}</Badge> : <Badge tone="amber">下書き</Badge>}
                  {v.id === template.current_version_id && <Badge tone="blue">現在の版</Badge>}
                </div>
                {v.body_hash && <div className="break-all font-mono text-xs text-slate-500">本文ハッシュ {v.body_hash}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BodyTab({
  title,
  body,
  setBody,
  variables,
  variableKeys,
  clauses,
  editable,
}: {
  title: string;
  body: DocNode;
  setBody: (d: DocNode) => void;
  variables: VariableDef[];
  variableKeys: string[];
  clauses: ClauseOption[];
  editable: boolean;
}) {
  const [mode, setMode] = useState<"pdf" | "html" | "off">("pdf");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode !== "pdf") return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, variables }),
          signal: ctrl.signal,
        });
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          setPdfUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
          });
        }
      } catch {
        // 中断
      } finally {
        setLoading(false);
      }
    }, 900);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [title, body, variables, mode]);
  const html = useMemo(() => {
    const map = new Map(variables.map((v) => [v.key, v]));
    return resolveDocument(body, (k) =>
      k === "発注者名" ? "（発注者名）" : map.has(k) ? formatValue(map.get(k), sampleValue(map.get(k)!)) : undefined,
    );
  }, [body, variables]);
  return (
    <div className={cx("grid gap-4", mode !== "off" && "xl:grid-cols-2")}>
      <div>
        <RichEditor value={body} onChange={setBody} variableKeys={variableKeys} clauses={clauses} readOnly={!editable} />
        <p className="mt-2 text-xs text-slate-500">
          「第N条」で条番号が自動で振られます。変数は {"{{変数名}}"} と直接入力しても使えます。
        </p>
      </div>
      <div className={mode === "off" ? "" : "xl:sticky xl:top-4 xl:self-start"}>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="font-semibold">プレビュー（サンプル値）</span>
          <Select className="w-auto" value={mode} onChange={(e) => setMode(e.target.value as "pdf" | "html" | "off")} aria-label="プレビューの種類">
            <option value="pdf">PDF</option>
            <option value="html">画面表示</option>
            <option value="off">閉じる</option>
          </Select>
          {loading && <span className="text-xs text-slate-500">更新中…</span>}
        </div>
        {mode === "pdf" && (pdfUrl ? <iframe title="PDFプレビュー" src={pdfUrl} className="h-[75vh] w-full rounded-lg ring-1 ring-slate-200" /> : <div className="h-40 rounded-lg bg-slate-100" />)}
        {mode === "html" && (
          <div className="max-h-[75vh] overflow-y-auto rounded-lg bg-white p-4 ring-1 ring-slate-200">
            <h1 className="mb-3 text-center text-lg font-bold">{title}</h1>
            <ContractBody doc={html} />
          </div>
        )}
      </div>
    </div>
  );
}

function VariablesTab({
  variables,
  setVariables,
  usedKeys,
  editable,
}: {
  variables: VariableDef[];
  setVariables: (v: VariableDef[]) => void;
  usedKeys: string[];
  editable: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const update = (i: number, patch: Partial<VariableDef>) => setVariables(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = (key: string) => {
    const k = key.trim();
    if (!isValidVariableKey(k) || variables.some((v) => v.key === k) || (SYSTEM_VARIABLES as readonly string[]).includes(k)) return;
    setVariables([...variables, { key: k, type: "text", filledBy: "admin", required: true }]);
    setNewKey("");
  };
  const missing = usedKeys.filter((k) => !variables.some((v) => v.key === k) && !(SYSTEM_VARIABLES as readonly string[]).includes(k));
  return (
    <Card title="変数（差し込み項目）">
      <p className="mb-3 text-sm text-slate-600">
        自動で入る変数：{SYSTEM_VARIABLES.map((k) => `{{${k}}}`).join("、")}
      </p>
      {editable && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="表示名（例：受講者氏名）" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(newKey)} />
          <Button type="button" onClick={() => add(newKey)}>追加</Button>
          {missing.map((k) => (
            <Button key={k} type="button" variant="secondary" onClick={() => add(k)}>
              ＋ {k}（本文で使用中）
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {variables.map((v, i) => (
          <div key={v.key} className="rounded-lg p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {"{{"}
                {v.key}
                {"}}"}
                {!usedKeys.includes(v.key) && <span className="ml-2 text-xs font-normal text-amber-700">本文で未使用</span>}
              </span>
              {editable && (
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" disabled={i === 0} onClick={() => { const a = [...variables]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; setVariables(a); }}>↑</Button>
                  <Button type="button" variant="ghost" onClick={() => setVariables(variables.filter((_, j) => j !== i))}>削除</Button>
                </div>
              )}
            </div>
            <fieldset disabled={!editable} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="型">
                <Select value={v.type} onChange={(e) => update(i, { type: e.target.value as VariableType })}>
                  {Object.entries(VARIABLE_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="入力者">
                <Select value={v.filledBy} onChange={(e) => update(i, { filledBy: e.target.value as "admin" | "signer" })}>
                  <option value="admin">管理者（契約作成時）</option>
                  <option value="signer">署名者（署名時）</option>
                </Select>
              </Field>
              <Field label="初期値">
                <Input value={v.defaultValue ?? ""} onChange={(e) => update(i, { defaultValue: e.target.value || undefined })} />
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input type="checkbox" checked={v.required} onChange={(e) => update(i, { required: e.target.checked })} /> 必須
              </label>
              {v.type === "select" && (
                <Field label="選択肢（改行区切り）">
                  <Textarea rows={3} value={(v.options ?? []).join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} />
                </Field>
              )}
              {["text", "longtext", "address"].includes(v.type) && (
                <>
                  <Field label="最小文字数">
                    <Input inputMode="numeric" value={v.rules?.minLength ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, minLength: e.target.value ? Number(e.target.value) : undefined } })} />
                  </Field>
                  <Field label="最大文字数">
                    <Input inputMode="numeric" value={v.rules?.maxLength ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
                  </Field>
                </>
              )}
              {["number", "money"].includes(v.type) && (
                <>
                  <Field label="最小値">
                    <Input inputMode="numeric" value={v.rules?.min ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, min: e.target.value ? Number(e.target.value) : undefined } })} />
                  </Field>
                  <Field label="最大値">
                    <Input inputMode="numeric" value={v.rules?.max ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, max: e.target.value ? Number(e.target.value) : undefined } })} />
                  </Field>
                </>
              )}
              {v.type === "date" && (
                <>
                  <Field label="日付の下限">
                    <Input type="date" value={v.rules?.minDate ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, minDate: e.target.value || undefined } })} />
                  </Field>
                  <Field label="日付の上限">
                    <Input type="date" value={v.rules?.maxDate ?? ""} onChange={(e) => update(i, { rules: { ...v.rules, maxDate: e.target.value || undefined } })} />
                  </Field>
                </>
              )}
              <Field label="プレビュー用サンプル値">
                <Input value={v.sample ?? ""} onChange={(e) => update(i, { sample: e.target.value || undefined })} />
              </Field>
              <Field label="入力時の説明">
                <Input value={v.help ?? ""} onChange={(e) => update(i, { help: e.target.value || undefined })} />
              </Field>
            </fieldset>
          </div>
        ))}
        {variables.length === 0 && <p className="text-sm text-slate-500">変数はまだありません。</p>}
      </div>
    </Card>
  );
}

function KeyClausesTab({ items, setItems, editable }: { items: KeyClause[]; setItems: (v: KeyClause[]) => void; editable: boolean }) {
  return (
    <Card title="重要条項（署名者に個別の確認を求める）">
      <p className="mb-3 text-sm text-slate-600">違約金、返金不可など、署名者に1つずつ「確認しました」のチェックを求める条項です。</p>
      <div className="space-y-3">
        {items.map((k, i) => (
          <fieldset key={k.id} disabled={!editable} className="grid gap-2 rounded-lg p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_2fr_auto]">
            <Field label="見出し">
              <Input value={k.title} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            </Field>
            <Field label="署名者に表示する説明">
              <Textarea rows={2} value={k.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            </Field>
            <div className="flex items-end">
              <Button type="button" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>削除</Button>
            </div>
          </fieldset>
        ))}
      </div>
      {editable && (
        <Button type="button" variant="secondary" className="mt-3" onClick={() => setItems([...items, { id: `k${Date.now().toString(36)}`, title: "", description: "" }])}>
          ＋ 重要条項を追加
        </Button>
      )}
    </Card>
  );
}
