import type { DataSource, FormMapping, Plan, Product } from "@zelnora/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, cx, Field, Input, PageHeader, Select, yen } from "../components/ui";
import { call } from "../lib/api";
import { useSession } from "../lib/session";
import { FormEditor } from "./settings/forms";
import { DICTIONARY_KEYS, ProgressTemplatesEditor, StagesEditor } from "./settings/products";

interface Draft {
  step: number;
  product: Product | null;
  plans: Plan[];
  storage: "db" | "sheet";
  dataSource: DataSource | null;
  persisted: boolean;
}

const STEPS = ["テンプレート", "商材名と呼び名", "プラン", "営業の段階", "提供の進め方", "データの保存先", "登録フォーム", "テストと公開"];

/** 設定ウィザード（ZN-SET-01）：8段階で商材を作る。途中で保存して再開できる */
export function WizardPage() {
  const s = useSession();
  const nav = useNavigate();
  const saved = s.settings.wizardDrafts?.current as Draft | undefined;
  const [d, setD] = useState<Draft>(saved ?? { step: 0, product: null, plans: [], storage: "db", dataSource: null, persisted: false });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(saved ? `途中から再開しました（${STEPS[saved.step]}）` : null);
  const [busy, setBusy] = useState(false);
  const p = d.product;

  const saveDraft = async (next: Draft) => {
    await call("settings.saveWizardDraft", { key: "current", draft: next });
  };
  const go = async (step: number, patch: Partial<Draft> = {}) => {
    setError(null);
    const next = { ...d, ...patch, step };
    setD(next);
    try {
      await saveDraft(next);
    } catch {
      // 途中保存に失敗しても入力は続けられる
    }
  };
  const persist = async () => {
    if (!p) return;
    setBusy(true);
    try {
      await call("settings.saveProduct", { product: { ...p, status: "stopped" } });
      for (const plan of d.plans) await call("settings.savePlan", { plan });
      if (d.storage === "sheet" && d.dataSource) await call("settings.saveDataSource", { dataSource: d.dataSource });
      await s.reload();
      await go(6, { persisted: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!p) return;
    setBusy(true);
    try {
      await call("settings.setProductStatus", { id: p.id, status: "active" });
      await call("settings.saveWizardDraft", { key: "current", draft: null });
      await s.reload();
      nav("/settings");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="設定ウィザード" description="新しい商材を、テンプレートから8つの手順で作ります。途中で閉じても、次に開いたときに続きから再開できます。" />
      <ol className="mb-5 flex flex-wrap gap-1 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className={cx("rounded-full px-3 py-1", i === d.step ? "bg-brand-600 font-bold text-white" : i < d.step ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-500")}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {info && <div className="mb-3"><Alert tone="info">{info}</Alert></div>}
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}

      {d.step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {s.templates.map((t) => (
            <button
              key={t.templateType}
              type="button"
              className="rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-2 hover:ring-brand-600"
              onClick={async () => {
                const product = await call<Product>("settings.productFromTemplate", { templateType: t.templateType, name: "" });
                setInfo(null);
                await go(1, { product, plans: [] });
              }}
            >
              <div className="font-bold">{t.label}</div>
              <div className="mt-1 text-sm text-slate-600">{t.description}</div>
            </button>
          ))}
        </div>
      )}

      {d.step === 1 && p && (
        <Card title="商材名と呼び名の辞書">
          <Field label="商材名" required>
            <Input value={p.name} onChange={(e) => setD({ ...d, product: { ...p, name: e.target.value } })} />
          </Field>
          <p className="mb-1 mt-3 text-sm font-semibold">画面に出す名前</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {DICTIONARY_KEYS.map(([k, def]) => (
              <Field key={k} label={`${def} →`}>
                <Input placeholder={def} value={p.dictionary[k] ?? ""} onChange={(e) => setD({ ...d, product: { ...p, dictionary: { ...p.dictionary, [k]: e.target.value } } })} />
              </Field>
            ))}
          </div>
          <Nav onBack={() => go(0)} onNext={() => (p.name.trim() ? go(2) : setError("商材名を入力してください"))} />
        </Card>
      )}

      {d.step === 2 && p && (
        <Card
          title="プラン"
          actions={
            <Button
              size="sm"
              onClick={async () => {
                const plan = await call<Plan>("settings.newPlan", { productId: p.id, plan: { name: "", priceIncl: 0, priceExcl: 0 } });
                setD({ ...d, plans: [...d.plans, plan] });
              }}
            >
              ＋ プランを追加
            </Button>
          }
        >
          {d.plans.map((pl, i) => {
            const set = (patch: Partial<Plan>) => setD({ ...d, plans: d.plans.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={pl.id} className="mb-2 grid gap-2 rounded-lg p-2 ring-1 ring-slate-200 sm:grid-cols-[1fr_9rem_9rem_7rem_auto]">
                <Input aria-label="プラン名" placeholder="プラン名" value={pl.name} onChange={(e) => set({ name: e.target.value })} />
                <Input
                  aria-label="金額（税込）"
                  type="number"
                  placeholder="税込"
                  value={pl.priceIncl || ""}
                  onChange={(e) => {
                    const incl = Number(e.target.value);
                    const tax = Math.floor((incl * pl.taxRate) / (1 + pl.taxRate));
                    set({ priceIncl: incl, priceExcl: incl - tax, priceBasis: "incl" });
                  }}
                />
                <div className="flex items-center gap-1">
                  <Input aria-label="期間" type="number" value={pl.duration.value} onChange={(e) => set({ duration: { ...pl.duration, value: Number(e.target.value) } })} />
                  <Select aria-label="期間の単位" value={pl.duration.unit} onChange={(e) => set({ duration: { ...pl.duration, unit: e.target.value as Plan["duration"]["unit"] } })}>
                    <option value="month">か月</option>
                    <option value="week">週</option>
                    <option value="day">日</option>
                  </Select>
                </div>
                <Select aria-label="支払い" value={pl.payment.type === "lump" ? "lump" : String(pl.payment.count)} onChange={(e) => set({ payment: e.target.value === "lump" ? { type: "lump", count: 1, intervalMonths: 1 } : { type: "installment", count: Number(e.target.value), intervalMonths: 1 } })}>
                  <option value="lump">一括</option>
                  <option value="3">分割3回</option>
                  <option value="6">分割6回</option>
                  <option value="12">分割12回</option>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setD({ ...d, plans: d.plans.filter((_, j) => j !== i) })}>
                  削除
                </Button>
                <span className="text-xs text-slate-500 sm:col-span-5">税抜 {yen(pl.priceExcl)}（詳細な設定は後から「設定 → プラン」で変更できます）</span>
              </div>
            );
          })}
          {d.plans.length === 0 && <p className="text-sm text-slate-500">少なくとも1つのプランを登録してください。</p>}
          <Nav onBack={() => go(1)} onNext={() => (d.plans.length && d.plans.every((x) => x.name.trim()) ? go(3) : setError("プラン名を入力したプランを1つ以上登録してください"))} />
        </Card>
      )}

      {d.step === 3 && p && (
        <>
          <StagesEditor stages={p.stages} fields={p.customFields.deal} onChange={(stages) => setD({ ...d, product: { ...p, stages } })} />
          <Nav onBack={() => go(2)} onNext={() => go(4)} />
        </>
      )}

      {d.step === 4 && p && (
        <>
          <ProgressTemplatesEditor templates={p.progressTemplates} onChange={(progressTemplates) => setD({ ...d, product: { ...p, progressTemplates } })} />
          <Nav onBack={() => go(3)} onNext={() => (p.progressTemplates.length ? go(5) : setError("進捗テンプレートを1つ以上作ってください"))} />
        </>
      )}

      {d.step === 5 && p && (
        <Card title="データの保存先">
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" checked={d.storage === "db"} onChange={() => setD({ ...d, storage: "db" })} />
              <span>
                <b>アプリ用のDBスプレッドシートに保存する（おすすめ）</b>
                <br />
                <span className="text-slate-500">新しく商材を始める場合はこちら。タブは自動で作られます。</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                checked={d.storage === "sheet"}
                onChange={() => setD({ ...d, storage: "sheet", dataSource: d.dataSource ?? { id: `ds${Date.now().toString(36)}`, name: `${p.name} 顧客管理`, spreadsheetId: "", entity: "customers", sheetName: "", headerRow: 1, columns: { id: "ID", name: "氏名", email: "メール" }, status: "check", lastCheckedAt: null, message: "" } })}
              />
              <span>
                <b>既存のスプレッドシートを使う</b>
                <br />
                <span className="text-slate-500">顧客の台帳として既存のシートを登録します（後から「データソース登録簿」で細かく設定できます）。</span>
              </span>
            </label>
          </div>
          {d.storage === "sheet" && d.dataSource && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label="スプレッドシートのURLまたはID">
                <Input value={d.dataSource.spreadsheetId} onChange={(e) => setD({ ...d, dataSource: { ...d.dataSource!, spreadsheetId: e.target.value.trim().replace(/^.*\/spreadsheets\/d\/([^/]+).*$/, "$1") } })} />
              </Field>
              <Field label="タブ名">
                <Input value={d.dataSource.sheetName} onChange={(e) => setD({ ...d, dataSource: { ...d.dataSource!, sheetName: e.target.value } })} />
              </Field>
              <Field label="見出しの行番号">
                <Input type="number" value={d.dataSource.headerRow} onChange={(e) => setD({ ...d, dataSource: { ...d.dataSource!, headerRow: Number(e.target.value) } })} />
              </Field>
            </div>
          )}
          <Alert tone="info">次へ進むと、ここまでの内容を「停止中」の商材として保存します（公開するまで営業の画面には出ません）。</Alert>
          <Nav onBack={() => go(4)} onNext={persist} nextLabel={busy ? "保存中…" : "保存して次へ"} disabled={busy} />
        </Card>
      )}

      {d.step === 6 && p && (
        <div className="space-y-4">
          {d.plans.map((pl) => {
            const existing = s.settings.forms.find((f) => f.planId === pl.id);
            const form: FormMapping = existing ?? { id: "", productId: p.id, planId: pl.id, name: `${pl.name} 登録フォーム`, responseSpreadsheetId: "", responseSheetName: pl.name, mapping: {}, matchBy: ["email", "phone"], actions: { advanceStage: true, createDelivery: true, notify: true }, active: true };
            return (
              <Card key={pl.id} title={`${pl.name} の登録フォーム`} actions={existing ? <span className="text-xs text-emerald-700">保存済み</span> : undefined}>
                <FormEditor inline form={form} onClose={() => {}} onSaved={async () => { await s.reload(); setInfo(`「${pl.name}」のフォームを保存しました`); }} />
              </Card>
            );
          })}
          <p className="text-sm text-slate-500">フォームがまだない場合は、あとで「設定 → フォームの対応付け」から登録できます。</p>
          <Nav onBack={() => go(5)} onNext={() => go(7)} />
        </div>
      )}

      {d.step === 7 && p && (
        <Card title="テストと公開">
          <ul className="mb-3 space-y-1 text-sm">
            <li>商材：{p.name}（段階 {p.stages.length}・進捗テンプレート {p.progressTemplates.length}）</li>
            <li>プラン：{d.plans.map((x) => `${x.name}（${yen(x.priceIncl)}）`).join("、")}</li>
            <li>登録フォーム：{s.settings.forms.filter((f) => f.productId === p.id).length}件</li>
            <li>データの保存先：{d.storage === "db" ? "アプリ用のDB" : "既存のスプレッドシート"}</li>
          </ul>
          <p className="text-sm text-slate-600">フォームのテスト取り込みは、前の手順の各フォームの「テスト取り込み」で実行できます（実データは変わりません）。</p>
          <Nav onBack={() => go(6)} onNext={publish} nextLabel={busy ? "公開中…" : "公開する"} disabled={busy} />
        </Card>
      )}
    </>
  );
}

function Nav({ onBack, onNext, nextLabel = "次へ", disabled }: { onBack: () => void; onNext: () => void; nextLabel?: string; disabled?: boolean }) {
  return (
    <div className="mt-4 flex justify-between">
      <Button variant="ghost" onClick={onBack}>
        ← 戻る
      </Button>
      <Button disabled={disabled} onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}
