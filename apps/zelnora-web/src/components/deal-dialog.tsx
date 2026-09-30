import { can, type Deal, type FieldDef, type Product, type Stage } from "@zelnora/core";
import { useMemo, useState } from "react";
import { ApiError, call } from "../lib/api";
import { useSession } from "../lib/session";
import { UserSelect } from "./pickers";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, yen } from "./ui";

const PAYMENT_METHODS = ["銀行振込", "クレジットカード", "分割（銀行振込）", "請求書払い", "口座振替"];

function fieldDef(product: Product, key: string): FieldDef {
  if (key === "planId") return { key, label: "プラン", type: "select" };
  if (key === "amount") return { key, label: "金額（税込）", type: "number" };
  if (key === "paymentMethod") return { key, label: "支払い方法", type: "select", options: PAYMENT_METHODS };
  return product.customFields.deal.find((f) => f.key === key) ?? { key, label: key, type: "text" };
}

function FieldInput({ product, def, value, onChange }: { product: Product; def: FieldDef; value: string; onChange: (v: string) => void }) {
  const s = useSession();
  if (def.key === "planId") {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
        <option value="">選択してください</option>
        {s.settings.plans
          .filter((p) => p.productId === product.id && p.status === "active")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{yen(p.priceIncl)}）
            </option>
          ))}
      </Select>
    );
  }
  if (def.type === "select") {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
        <option value="">選択してください</option>
        {(def.options ?? []).map((o) => (
          <option key={o}>{o}</option>
        ))}
      </Select>
    );
  }
  if (def.type === "textarea") return <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label} />;
  const type = def.type === "number" ? "number" : def.type === "date" ? "date" : def.type === "datetime" ? "datetime-local" : "text";
  return <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label} />;
}

/** 段階の移動（必須項目が足りなければその場で入力：ZN-SALES-03/04） */
export function MoveStageDialog({ deal, product, target, onClose, onDone }: { deal: Deal; product: Product; target?: Stage; onClose: () => void; onDone: (r: { registrationUrl?: string | null }) => void }) {
  const s = useSession();
  const priceOf = (planId: string) => s.settings.plans.find((p) => p.id === planId)?.priceIncl ?? 0;
  const stages = useMemo(() => [...product.stages].sort((a, b) => a.order - b.order), [product]);
  const [stageId, setStageId] = useState(target?.id ?? deal.stageId);
  const stage = stages.find((x) => x.id === stageId)!;
  const [values, setValues] = useState<Record<string, string>>({
    planId: deal.planId ?? "",
    amount: deal.amount ? String(deal.amount) : "",
    paymentMethod: deal.paymentMethod ?? "",
    ...deal.fields,
  });
  const [actionTitle, setActionTitle] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsAction = ["new", "contact", "meeting", "contract", "hold"].includes(stage.kind);
  const required = stage.requiredFields;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) if (!["planId", "amount", "paymentMethod"].includes(k) && v !== undefined) fields[k] = v;
      const r = await call<{ registrationUrl?: string | null }>("deals.move", {
        id: deal.id,
        move: {
          stageId,
          planId: values.planId || null,
          amount: values.amount ? Number(values.amount) : deal.amount,
          paymentMethod: values.paymentMethod || null,
          fields,
          ...(actionTitle.trim() ? { nextAction: { title: actionTitle, due: actionDue } } : {}),
          note,
        },
      });
      onDone(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="段階を変更"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button disabled={busy} onClick={submit}>
            {stage.name} に進める
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="移動先の段階">
        <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </Select>
      </Field>
      {required.length > 0 && <p className="text-xs font-semibold text-slate-600">この段階に必要な項目</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {required.map((k) => {
          const def = fieldDef(product, k);
          return (
            <Field key={k} label={def.label} required>
              <FieldInput product={product} def={def} value={values[k] ?? ""} onChange={(v) => setValues({ ...values, [k]: v, ...(k === "planId" && v ? { amount: String(priceOf(v)) } : {}) })} />
            </Field>
          );
        })}
      </div>
      {stage.kind === "lost" && (
        <Field label="再アプローチの予定日（任意）">
          <Input type="date" value={values.reapproachDate ?? ""} onChange={(e) => setValues({ ...values, reapproachDate: e.target.value })} />
        </Field>
      )}
      {stage.kind !== "registered" && (
        <>
          <p className="text-xs font-semibold text-slate-600">
            次のアクション{needsAction ? "" : "（任意）"}
            {stage.defaultNextAction && <span className="ml-1 font-normal text-slate-500">未入力なら「{stage.defaultNextAction.title}」を設定します</span>}
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input placeholder="内容" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} aria-label="次のアクションの内容" />
            <Input type="date" value={actionDue} onChange={(e) => setActionDue(e.target.value)} aria-label="次のアクションの期限" />
          </div>
        </>
      )}
      <Field label="メモ">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** 商談の詳細（担当・金額・項目の編集と段階の移動） */
export function DealDialog({ deal, onClose, onChanged }: { deal: Deal; onClose: () => void; onChanged: () => void }) {
  const s = useSession();
  const product = s.product(deal.productId)!;
  const [moving, setMoving] = useState(false);
  const [owner, setOwner] = useState(deal.owner ?? "");
  const [fields, setFields] = useState<Record<string, string>>(deal.fields);
  const [amount, setAmount] = useState(deal.amount ? String(deal.amount) : "");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const stage = product.stages.find((x) => x.id === deal.stageId);
  const canEdit = can(s.user, "deals.edit") && (s.user.role !== "sales" || deal.owner === s.user.email);
  const save = async () => {
    try {
      await call("deals.update", { id: deal.id, version: deal.version, patch: { fields, amount: amount ? Number(amount) : null, ...(owner !== (deal.owner ?? "") ? { owner: owner || null } : {}) } });
      setMsg({ tone: "success", text: "保存しました" });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <>
      <Modal
        open={!moving}
        wide
        title={`${s.labels(product.id).deal}：${product.name}`}
        onClose={onClose}
        footer={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setMoving(true)}>
                段階を変更
              </Button>
              <Button onClick={save}>保存</Button>
            </>
          ) : undefined
        }
      >
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {url && (
          <Alert tone="success">
            成約しました。{s.labels(product.id).registration}フォームの案内URL：
            <button type="button" className="ml-1 break-all underline" onClick={() => navigator.clipboard?.writeText(url)}>
              {url}（コピー）
            </button>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={deal.status === "won" ? "green" : deal.status === "lost" ? "red" : "blue"}>{stage?.name}</Badge>
          {deal.nextAction && (
            <span>
              次：{deal.nextAction.title}（{deal.nextAction.due}）
            </span>
          )}
        </div>
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="段階の進み具合">
          {[...product.stages]
            .filter((x) => x.kind !== "lost" && x.kind !== "hold")
            .sort((a, b) => a.order - b.order)
            .map((x) => (
              <li key={x.id} className={`rounded px-2 py-1 ${x.order <= (stage?.order ?? 0) && deal.status !== "lost" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {x.name}
              </li>
            ))}
        </ol>
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          <Field label="担当営業">
            <UserSelect value={owner} onChange={setOwner} roles={["sales", "manager", "admin", "owner"]} allowEmpty />
          </Field>
          <Field label="見込み金額（税込）">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="プラン">
            <Input readOnly value={s.settings.plans.find((p) => p.id === deal.planId)?.name ?? "（未定）"} />
          </Field>
          <Field label="支払い方法">
            <Input readOnly value={deal.paymentMethod ?? ""} />
          </Field>
          {product.customFields.deal
            .filter((f) => !(f.hiddenFromRoles ?? []).includes(s.user.role))
            .map((f) => (
              <Field key={f.key} label={f.label}>
                <FieldInput product={product} def={f} value={fields[f.key] ?? ""} onChange={(v) => setFields({ ...fields, [f.key]: v })} />
              </Field>
            ))}
        </fieldset>
        <details className="text-xs text-slate-500">
          <summary>段階の履歴</summary>
          <ul className="mt-1 space-y-0.5">
            {deal.history.map((h, i) => (
              <li key={i}>
                {h.at.slice(0, 16).replace("T", " ")} {product.stages.find((x) => x.id === h.stageId)?.name} （{s.userName(h.by)}）
              </li>
            ))}
          </ul>
        </details>
      </Modal>
      {moving && (
        <MoveStageDialog
          deal={deal}
          product={product}
          onClose={() => setMoving(false)}
          onDone={(r) => {
            setMoving(false);
            if (r.registrationUrl) setUrl(r.registrationUrl);
            onChanged();
          }}
        />
      )}
    </>
  );
}
