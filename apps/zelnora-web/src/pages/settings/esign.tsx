import { type EsignSettings, type EsignTemplateInfo, esignValueSources, guessEsignSource } from "@zelnora/core";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "../../components/ui";
import { ApiError, call } from "../../lib/api";
import { DEMO } from "../../lib/config";
import { useSession } from "../../lib/session";

const DEFAULTS: EsignSettings = { enabled: false, baseUrl: "", sendEmail: true, expiresInDays: 14, autoRequest: true, autoWon: true, plans: {} };

/** 電子契約システムとの連携（12章） */
export function EsignSettingsPage() {
  const s = useSession();
  const [f, setF] = useState<EsignSettings>({ ...DEFAULTS, ...(s.settings.esign ?? {}) });
  const [templates, setTemplates] = useState<EsignTemplateInfo[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: EsignSettings, text = "保存しました") => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await call<EsignSettings>("esign.saveSettings", { settings: next });
      setF(saved);
      setMsg({ tone: "success", text });
      await s.reload();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadTemplates = async () => {
    // URLを変えた場合は先に保存する（テンプレートは保存したURLから読み込む）
    if (f.baseUrl !== (s.settings.esign?.baseUrl ?? "") && !(await save(f, "URLを保存しました"))) return;
    setBusy(true);
    try {
      const t = await call<EsignTemplateInfo[]>("esign.templates");
      setTemplates(t);
      setMsg({ tone: "success", text: `接続できました。公開済みのテンプレートが ${t.length} 件あります。` });
    } catch (e) {
      setMsg({ tone: "error", text: `接続できません：${e instanceof ApiError ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const setPlan = (planId: string, templateId: string) => {
    const plans = { ...f.plans };
    const t = templates?.find((x) => x.id === templateId);
    if (!templateId) delete plans[planId];
    else {
      const prev = plans[planId]?.templateId === templateId ? plans[planId]!.values : {};
      const values: Record<string, string> = {};
      for (const v of t?.variables.filter((x) => x.filledBy === "admin") ?? []) values[v.key] = prev[v.key] ?? guessEsignSource(v);
      plans[planId] = { templateId, templateName: t?.name ?? plans[planId]?.templateName, values };
    }
    setF({ ...f, plans });
  };
  const setValue = (planId: string, key: string, source: string) => {
    const p = f.plans[planId]!;
    setF({ ...f, plans: { ...f.plans, [planId]: { ...p, values: { ...p.values, [key]: source } } } });
  };

  const activePlans = s.settings.plans.filter((p) => p.status === "active");
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="電子契約システムとの接続">
        <p className="mb-3 text-sm text-slate-600">
          契約の段階で契約書を作成して顧客に送り、署名が完了したら自動で成約にします。
          {DEMO && "（デモでは、ブラウザ内の仮の電子契約システムにつながります）"}
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          電子契約の連携を使う
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="電子契約システムのURL" hint="例：https://sign.example.jp">
            <Input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="署名の有効期限（日）">
            <Input type="number" min={1} max={365} value={f.expiresInDays} onChange={(e) => setF({ ...f, expiresInDays: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.autoRequest} onChange={(e) => setF({ ...f, autoRequest: e.target.checked })} />
            契約の段階に移したら、自動で契約書を作成して送る
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.sendEmail} onChange={(e) => setF({ ...f, sendEmail: e.target.checked })} />
            署名URLを顧客にメールでも送る（オフならURLを担当者が送る）
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.autoWon} onChange={(e) => setF({ ...f, autoWon: e.target.checked })} />
            署名が完了したら、自動で成約にする
          </label>
        </div>
        {!DEMO && (
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer">APIキーと通知の設定（初回のみ）</summary>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>電子契約システムの環境変数 INTEGRATION_API_KEY と、Apps Script のスクリプトプロパティ ESIGN_API_KEY に同じ値を設定します。</li>
              <li>電子契約システムの INTEGRATION_WEBHOOK_URL にこの Apps Script のウェブアプリのURLを、INTEGRATION_WEBHOOK_SECRET と ESIGN_WEBHOOK_SECRET に同じ値を設定します。</li>
              <li>APIキーなどの秘密の値は、この画面や設定のスプレッドシートには保存しません。</li>
            </ol>
          </details>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save(f)}>
            保存
          </Button>
          <Button variant="secondary" disabled={busy || !f.baseUrl} onClick={() => void loadTemplates()}>
            接続を確認してテンプレートを読み込む
          </Button>
        </div>
      </Card>

      <Card title="プランごとの契約書">
        {!templates ? (
          <p className="text-sm text-slate-500">
            「接続を確認してテンプレートを読み込む」を押すと、プランごとに使う契約書（電子契約システムで公開したテンプレート）を選べます。
            {Object.keys(f.plans).length > 0 && ` 設定済み：${Object.keys(f.plans).length}件`}
          </p>
        ) : (
          <div className="space-y-4">
            {s.activeProducts.map((product) => {
              const plans = activePlans.filter((p) => p.productId === product.id);
              if (!plans.length) return null;
              const sources = esignValueSources(product);
              return (
                <div key={product.id}>
                  <h3 className="mb-2 text-sm font-semibold">{product.name}</h3>
                  <div className="space-y-3">
                    {plans.map((plan) => {
                      const m = f.plans[plan.id];
                      const t = templates.find((x) => x.id === m?.templateId);
                      return (
                        <div key={plan.id} className="rounded-lg p-3 ring-1 ring-slate-200">
                          <Field label={`${plan.name} の契約書`}>
                            <Select value={m?.templateId ?? ""} onChange={(e) => setPlan(plan.id, e.target.value)} aria-label={`${plan.name} の契約書`}>
                              <option value="">使わない</option>
                              {templates.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          {m && !t && <p className="mt-1 text-xs text-rose-700">選んでいたテンプレート（{m.templateName ?? m.templateId}）が見つかりません。選び直してください。</p>}
                          {t && (
                            <table className="mt-2 w-full text-sm">
                              <thead className="text-left text-xs text-slate-500">
                                <tr>
                                  <th className="py-1">契約書の項目</th>
                                  <th className="py-1">入れる値</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.variables
                                  .filter((v) => v.filledBy === "admin")
                                  .map((v) => {
                                    const src = m!.values[v.key] ?? "";
                                    const fixed = src.startsWith("text:");
                                    return (
                                      <tr key={v.key} className="border-t border-slate-100">
                                        <td className="py-1 pr-2">
                                          {v.key}
                                          {v.required && <span className="ml-1 text-rose-600">*</span>}
                                        </td>
                                        <td className="py-1">
                                          <div className="flex flex-wrap gap-2">
                                            <Select
                                              className="w-auto"
                                              aria-label={`${plan.name}・${v.key}`}
                                              value={fixed ? "text:" : src}
                                              onChange={(e) => setValue(plan.id, v.key, e.target.value)}
                                            >
                                              <option value="">（空欄・電子契約システムの既定値）</option>
                                              {sources.map((o) => (
                                                <option key={o.key} value={o.key}>
                                                  {o.label}
                                                </option>
                                              ))}
                                              <option value="text:">固定の文字</option>
                                            </Select>
                                            {fixed && <Input className="w-48" value={src.slice(5)} onChange={(e) => setValue(plan.id, v.key, `text:${e.target.value}`)} aria-label={`${v.key}の固定の文字`} />}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <Button disabled={busy} onClick={() => void save(f)}>
              保存
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
