import { computeTax, type Plan, REVENUE_RULE_LABELS } from "@zelnora/core";
import { useState } from "react";
import { ProductPicker } from "../../components/pickers";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea, yen } from "../../components/ui";
import { call } from "../../lib/api";
import { useSession } from "../../lib/session";

export function PlansSettings() {
  const s = useSession();
  const [productId, setProductId] = useState(s.settings.products[0]?.id ?? "");
  const [editing, setEditing] = useState<Plan | null>(null);
  const [revising, setRevising] = useState<Plan | null>(null);
  const plans = s.settings.plans.filter((p) => p.productId === productId);
  return (
    <Card
      title={<ProductPicker value={productId} onChange={setProductId} />}
      actions={
        productId && (
          <Button
            size="sm"
            onClick={async () => setEditing(await call<Plan>("settings.newPlan", { productId, plan: { name: "" } }))}
          >
            ＋ プランを追加
          </Button>
        )
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">プラン名</th>
            <th className="py-1 text-right">税込</th>
            <th className="py-1 text-right">税抜</th>
            <th className="py-1">期間</th>
            <th className="py-1">支払い</th>
            <th className="py-1">計上</th>
            <th className="py-1">状態</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="py-2 font-semibold">{p.name}</td>
              <td className="py-2 text-right tabular-nums">{yen(p.priceIncl)}</td>
              <td className="py-2 text-right tabular-nums">{yen(p.priceExcl)}</td>
              <td className="py-2">
                {p.duration.value}
                {{ day: "日", week: "週", month: "か月" }[p.duration.unit]}
              </td>
              <td className="py-2 text-xs">{p.payment.type === "lump" ? "一括" : `分割 ${p.payment.count}回`}</td>
              <td className="py-2 text-xs">{REVENUE_RULE_LABELS[p.revenueRule ?? s.product(p.productId)!.revenueRule]}</td>
              <td className="py-2">{p.status === "active" ? <Badge tone="green">販売中</Badge> : <Badge>停止</Badge>}</td>
              <td className="py-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                  編集
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRevising(p)}>
                  価格の改定
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plans.length === 0 && <p className="py-6 text-center text-sm text-slate-500">プランはまだありません</p>}
      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await s.reload(); }} />}
      {revising && <RevisionDialog plan={revising} onClose={() => setRevising(null)} onSaved={async () => { setRevising(null); await s.reload(); }} />}
    </Card>
  );
}

export function PlanDialog({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const isNew = !s.settings.plans.some((x) => x.id === plan.id);
  const [p, setP] = useState<Plan>(plan);
  const [error, setError] = useState<string | null>(null);
  const product = s.product(p.productId);
  const setPrice = (value: number, basis: "excl" | "incl", rate = p.taxRate, rounding = p.rounding) => {
    const t = computeTax(value, basis, rate, rounding);
    setP({ ...p, priceBasis: basis, priceExcl: t.excl, priceIncl: t.incl, taxRate: rate, rounding });
  };
  return (
    <Modal
      open
      wide
      title={isNew ? "プランを追加" : `プランの編集：${plan.name}`}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              if (!p.name.trim()) throw new Error("プラン名を入力してください");
              // 新規は価格の履歴なし。既存の価格変更は「価格の改定」から行う
              await call("settings.savePlan", { plan: isNew ? p : { ...p, priceExcl: plan.priceExcl, priceIncl: plan.priceIncl } });
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="プラン名" required>
          <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field label="販売状態" hint="停止中のプランは新しい商談で選べません">
          <Select value={p.status} onChange={(e) => setP({ ...p, status: e.target.value as Plan["status"] })}>
            <option value="active">販売中</option>
            <option value="stopped">停止</option>
          </Select>
        </Field>
        <Field label="入力の基準">
          <Select value={p.priceBasis} disabled={!isNew} onChange={(e) => setPrice(p.priceBasis === "incl" ? p.priceIncl : p.priceExcl, e.target.value as "excl" | "incl")}>
            <option value="incl">税込で入力</option>
            <option value="excl">税抜で入力</option>
          </Select>
        </Field>
        <Field label={p.priceBasis === "incl" ? "金額（税込）" : "金額（税抜）"} hint={isNew ? `税抜 ${yen(p.priceExcl)} ／ 税込 ${yen(p.priceIncl)}` : "既存プランの価格は「価格の改定」から変更します"}>
          <Input type="number" disabled={!isNew} value={p.priceBasis === "incl" ? p.priceIncl : p.priceExcl} onChange={(e) => setPrice(Number(e.target.value), p.priceBasis)} />
        </Field>
        <Field label="消費税率（%）">
          <Input type="number" disabled={!isNew} value={Math.round(p.taxRate * 1000) / 10} onChange={(e) => setPrice(p.priceBasis === "incl" ? p.priceIncl : p.priceExcl, p.priceBasis, Number(e.target.value) / 100)} />
        </Field>
        <Field label="端数の扱い">
          <Select value={p.rounding} disabled={!isNew} onChange={(e) => setPrice(p.priceBasis === "incl" ? p.priceIncl : p.priceExcl, p.priceBasis, p.taxRate, e.target.value as Plan["rounding"])}>
            <option value="floor">切り捨て</option>
            <option value="round">四捨五入</option>
          </Select>
        </Field>
        <Field label="期間">
          <div className="flex gap-1">
            <Input type="number" value={p.duration.value} onChange={(e) => setP({ ...p, duration: { ...p.duration, value: Number(e.target.value) } })} />
            <Select className="w-24" value={p.duration.unit} onChange={(e) => setP({ ...p, duration: { ...p.duration, unit: e.target.value as Plan["duration"]["unit"] } })}>
              <option value="day">日</option>
              <option value="week">週</option>
              <option value="month">か月</option>
            </Select>
          </div>
        </Field>
        <Field label="支払い方法">
          <div className="flex gap-1">
            <Select value={p.payment.type} onChange={(e) => setP({ ...p, payment: { ...p.payment, type: e.target.value as "lump" | "installment" } })}>
              <option value="lump">一括</option>
              <option value="installment">分割</option>
            </Select>
            {p.payment.type === "installment" && (
              <>
                <Input aria-label="回数" type="number" className="w-20" value={p.payment.count} onChange={(e) => setP({ ...p, payment: { ...p.payment, count: Number(e.target.value) } })} />回
                <Input aria-label="間隔（月）" type="number" className="w-20" value={p.payment.intervalMonths} onChange={(e) => setP({ ...p, payment: { ...p.payment, intervalMonths: Number(e.target.value) } })} />か月ごと
              </>
            )}
          </div>
        </Field>
        <Field label="計上ルール">
          <Select value={p.revenueRule ?? ""} onChange={(e) => setP({ ...p, revenueRule: (e.target.value || null) as Plan["revenueRule"] })}>
            <option value="">商材の既定（{REVENUE_RULE_LABELS[product?.revenueRule ?? "lump"]}）</option>
            {Object.entries(REVENUE_RULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="進捗テンプレート">
          <Select value={p.progressTemplateId ?? ""} onChange={(e) => setP({ ...p, progressTemplateId: e.target.value || null })}>
            <option value="">商材の最初のテンプレート</option>
            {product?.progressTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="内容（営業・提供担当が参照する説明）">
        <Textarea rows={3} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
      </Field>
      {p.priceHistory.length > 0 && (
        <div className="text-xs text-slate-500">
          価格の改定履歴：
          {p.priceHistory.map((h) => `${h.effectiveFrom}〜 ${yen(h.priceIncl)}`).join(" → ")}
        </div>
      )}
    </Modal>
  );
}

function RevisionDialog({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [value, setValue] = useState(String(plan.priceBasis === "incl" ? plan.priceIncl : plan.priceExcl));
  const [error, setError] = useState<string | null>(null);
  const t = computeTax(Number(value) || 0, plan.priceBasis, plan.taxRate, plan.rounding);
  return (
    <Modal
      open
      title={`価格の改定：${plan.name}`}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              if (!effectiveFrom) throw new Error("改定日を入力してください");
              await call("settings.revisePrice", { planId: plan.id, effectiveFrom, priceExcl: t.excl, priceIncl: t.incl });
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          改定する
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-600">改定日以降の契約だけが新しい価格になります。過去の売上は変わりません。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="改定日">
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label={plan.priceBasis === "incl" ? "新しい金額（税込）" : "新しい金額（税抜）"} hint={`税抜 ${yen(t.excl)} ／ 税込 ${yen(t.incl)}`}>
          <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
