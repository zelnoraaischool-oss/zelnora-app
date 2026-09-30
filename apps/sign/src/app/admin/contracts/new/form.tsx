"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { UrlShare } from "@/components/url-share";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { VariableInput } from "@/components/variable-input";
import { copyAsync } from "@/lib/clipboard";
import { validateValues, type VariableDef } from "@/lib/contract/variables";
import type { ContactRow } from "@/lib/server/types";
import { createContractAction, searchContactsAction } from "../../actions";

interface Tpl {
  id: string;
  name: string;
  description: string;
  version_no: number;
  variables: VariableDef[];
}

export function NewContractForm({
  templates,
  defaultExpiryDays,
  initialTemplateId,
}: {
  templates: Tpl[];
  defaultExpiryDays: number;
  initialTemplateId?: string;
}) {
  // テンプレートは最近更新した順に並んでいる（先頭が既定）
  const [templateId, setTemplateId] = useState(initialTemplateId ?? templates[0]!.id);
  const tpl = templates.find((t) => t.id === templateId) ?? templates[0]!;
  const adminVars = useMemo(() => tpl.variables.filter((v) => v.filledBy === "admin"), [tpl]);

  const [signer, setSigner] = useState({ contactId: "", name: "", email: "", phone: "", company: "" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [touchedVars, setTouchedVars] = useState<Record<string, boolean>>({});
  const [channels, setChannels] = useState<{ url: boolean; email: boolean }>({ url: true, email: true });
  const [expiresInDays, setExpiresInDays] = useState(defaultExpiryDays);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ contractId: string; url: string; copied: boolean; emailSent?: boolean } | null>(null);

  // 氏名系の変数は署名者の氏名で自動入力する（手で変えた場合はそのまま）
  const effectiveValues = useMemo(() => {
    const v: Record<string, string> = {};
    for (const def of adminVars) {
      let val = values[def.key];
      if (val === undefined) {
        if (/氏名|名前|お名前/.test(def.key) && def.type === "text") val = signer.name;
        else if (def.type === "email") val = signer.email;
        else if (def.type === "phone") val = signer.phone;
        else if (def.type === "date" && /契約日|申込日|取引日/.test(def.key)) val = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
        else val = def.defaultValue ?? "";
      }
      v[def.key] = val;
    }
    return v;
  }, [adminVars, values, signer]);

  // 連絡先の検索
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ContactRow[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => setResults(await searchContactsAction(value)), 250);
  };

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!signer.name.trim()) errs.__name = "署名者の氏名を入力してください";
    if (channels.email && !signer.email.trim()) errs.__email = "メールで送信するにはメールアドレスが必要です";
    if (!channels.email && !channels.url) errs.__channel = "送付方法を1つ以上選んでください";
    const r = validateValues(adminVars, effectiveValues);
    Object.assign(errs, r.errors);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(copy: boolean) {
    setError(null);
    if (!validate()) return;
    setBusy(true);
    const request = createContractAction({
      templateId,
      signer: {
        contactId: signer.contactId || undefined,
        name: signer.name,
        email: signer.email || null,
        phone: signer.phone || null,
        company: signer.company || null,
      },
      values: effectiveValues,
      channels: [...(channels.url ? ["url" as const] : []), ...(channels.email ? ["email" as const] : [])],
      expiresInDays,
    });
    const copied = copy
      ? copyAsync(
          request.then((r) => {
            if (!r.ok) throw new Error(r.error);
            return r.url;
          }),
        )
      : Promise.resolve(false);
    const r = await request;
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDone({ contractId: r.contractId, url: r.url, copied: await copied, emailSent: r.sent.email });
  }

  if (done) {
    return (
      <Card title="契約を作成しました">
        <div className="space-y-4">
          {done.copied && <Alert tone="success">署名URLをクリップボードにコピーしました。</Alert>}
          {channels.email && (
            <Alert tone={done.emailSent ? "success" : "error"}>
              {done.emailSent ? `${signer.email} へメールを送信しました。` : "メールの送信に失敗しました。URLをコピーして送るか、詳細画面から再送してください。"}
            </Alert>
          )}
          <UrlShare url={done.url} copied={done.copied} />
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-lg px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-600" href={`/admin/contracts/${done.contractId}`}>
              契約の詳細を見る
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setSigner({ contactId: "", name: "", email: "", phone: "", company: "" });
                setValues({});
                setTouchedVars({});
              }}
            >
              続けて作成する
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card title="1. テンプレート">
        <div className="space-y-2">
          {templates.map((t) => (
            <label
              key={t.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ${t.id === templateId ? "bg-brand-50 ring-2 ring-brand-600" : "ring-slate-200"}`}
            >
              <input type="radio" name="template" className="mt-1" checked={t.id === templateId} onChange={() => { setTemplateId(t.id); setValues({}); }} />
              <span>
                <span className="block font-semibold">{t.name}</span>
                <span className="block text-xs text-slate-500">
                  第{t.version_no}版 {t.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="2. 署名者と内容">
        <div className="space-y-4">
          <Field label="連絡先から検索" hint="氏名・メール・会社名で検索できます">
            <Input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="例：山田" />
          </Field>
          {results.length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-200">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setSigner({ contactId: c.id, name: c.name, email: c.email ?? "", phone: c.phone ?? "", company: c.company ?? "" });
                      setQ("");
                      setResults([]);
                    }}
                  >
                    <span className="font-semibold">{c.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.company} {c.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Field label="署名者の氏名" required error={errors.__name}>
              <Input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value, contactId: signer.contactId })} autoComplete="off" />
            </Field>
            <Field label="メールアドレス" error={errors.__email}>
              <Input type="email" value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="電話番号">
              <Input type="tel" value={signer.phone} onChange={(e) => setSigner({ ...signer, phone: e.target.value })} />
            </Field>
            <Field label="会社名（法人の場合）">
              <Input value={signer.company} onChange={(e) => setSigner({ ...signer, company: e.target.value })} />
            </Field>
          </div>
          {adminVars.length > 0 && <hr className="border-slate-200" />}
          {adminVars.map((def) => (
            <VariableInput
              key={`${tpl.id}-${def.key}`}
              def={def}
              value={effectiveValues[def.key] ?? ""}
              error={errors[def.key]}
              onChange={(v) => {
                setValues({ ...values, [def.key]: v });
                setTouchedVars({ ...touchedVars, [def.key]: true });
              }}
            />
          ))}
        </div>
      </Card>

      <Card title="3. 送付方法">
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={channels.url} onChange={(e) => setChannels({ ...channels, url: e.target.checked })} />
            <span>
              <span className="block font-semibold">URLをコピー</span>
              <span className="block text-xs text-slate-500">署名URLとQRコードを表示します。DMや他のSNSで送るときに。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={channels.email} onChange={(e) => setChannels({ ...channels, email: e.target.checked })} />
            <span>
              <span className="block font-semibold">メールで送信</span>
              <span className="block text-xs text-slate-500">署名者のメールアドレスへ署名URLを自動送信します。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg p-3 text-slate-400 ring-1 ring-slate-200">
            <input type="checkbox" className="mt-1 h-5 w-5" disabled />
            <span>
              <span className="block font-semibold">LINEで送信</span>
              <span className="block text-xs">フェーズ2で対応予定です。</span>
            </span>
          </label>
          {errors.__channel && <p className="text-xs text-rose-600">{errors.__channel}</p>}
          <Field label="有効期限（日）" hint="既定は設定画面で変更できます">
            <Input type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          {Object.keys(errors).length > 0 && !error && <Alert tone="error">入力内容を確認してください。</Alert>}
          <Button className="w-full text-base" disabled={busy} onClick={() => submit(true)}>
            {busy ? "作成中…" : "作成と同時にURLをコピー"}
          </Button>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => submit(false)}>
            作成する
          </Button>
        </div>
      </Card>
    </div>
  );
}
