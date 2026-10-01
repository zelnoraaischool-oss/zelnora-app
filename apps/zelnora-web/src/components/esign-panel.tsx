import type { Deal, DealEsign } from "@zelnora/core";
import { useState } from "react";
import { ApiError, call } from "../lib/api";
import { DEMO } from "../lib/config";
import { useSession } from "../lib/session";
import { Alert, Badge, Button } from "./ui";

const STATUS: Record<DealEsign["status"], { label: string; tone: "blue" | "amber" | "green" | "red" | "slate" }> = {
  sent: { label: "署名待ち", tone: "blue" },
  viewed: { label: "閲覧済み", tone: "amber" },
  signed: { label: "署名完了", tone: "green" },
  canceled: { label: "取消", tone: "red" },
  expired: { label: "期限切れ", tone: "slate" },
};

export function EsignBadge({ esign }: { esign: DealEsign | null | undefined }) {
  if (!esign) return null;
  const st = STATUS[esign.status];
  return <Badge tone={st.tone}>電子契約：{st.label}</Badge>;
}

/** 商談の電子契約（作成・署名URLのコピー・状態の確認） */
export function EsignPanel({ deal, canEdit, onChanged }: { deal: Deal; canEdit: boolean; onChanged: (d: Deal) => void }) {
  const s = useSession();
  const cfg = s.settings.esign;
  const [esign, setEsign] = useState<DealEsign | null>(deal.esign ?? null);
  const [status, setStatus] = useState<Deal["status"]>(deal.status);
  const [sendEmail, setSendEmail] = useState(cfg?.sendEmail ?? true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!cfg?.enabled && !esign) return null;
  const mapped = !!(deal.planId && cfg?.plans[deal.planId]?.templateId);
  const ended = !esign || esign.status === "canceled" || esign.status === "expired";
  const canRequest = canEdit && status === "open" && ended && !!cfg?.enabled;

  const run = async (fn: () => Promise<{ deal: Deal } & Record<string, unknown>>, done: (r: Record<string, unknown>) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setEsign(r.deal.esign ?? null);
      setStatus(r.deal.status);
      onChanged(r.deal);
      setMsg({ tone: "success", text: done(r) });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const request = () =>
    run(
      () => call<{ deal: Deal; url: string | null; emailSent: boolean }>("deals.requestEsign", { id: deal.id, sendEmail }),
      (r) => (r.emailSent ? "契約書を作成し、顧客にメールで送りました。" : "契約書を作成しました。署名URLを顧客に送ってください。"),
    );
  const refresh = () =>
    run(
      () => call<{ deal: Deal; won: boolean; changed: boolean }>("deals.refreshEsign", { id: deal.id }),
      (r) => (r.won ? "署名が完了したため、成約にしました。" : r.changed ? "状態を更新しました。" : "変わりはありません。"),
    );
  const demoSign = () =>
    run(
      () => call<{ deal: Deal; won: boolean }>("demo.esignSign", { id: deal.id }),
      (r) => (r.won ? "（デモ）署名が完了し、成約になりました。" : "（デモ）署名が完了しました。"),
    );

  const copy = async () => {
    if (!esign?.url) return;
    try {
      await navigator.clipboard.writeText(esign.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("署名URL", esign.url);
    }
  };

  return (
    <section aria-label="電子契約" className="space-y-2 rounded-lg p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">電子契約</h3>
        <EsignBadge esign={esign} />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {esign && (
        <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>作成：{esign.requestedAt.slice(0, 16).replace("T", " ")}（{s.userName(esign.requestedBy)}）</div>
          {esign.signedAt && <div>署名：{new Date(esign.signedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</div>}
          {esign.sha256 && <div className="break-all sm:col-span-2">確定版PDFのSHA-256：{esign.sha256}</div>}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {esign?.url && (esign.status === "sent" || esign.status === "viewed") && (
          <Button size="sm" variant="secondary" onClick={copy}>
            {copied ? "コピーしました" : "署名URLをコピー"}
          </Button>
        )}
        {esign?.adminUrl && (
          <a className="text-xs text-brand-700 underline" href={esign.adminUrl} target="_blank" rel="noreferrer noopener">
            電子契約システムで開く
          </a>
        )}
        {esign && canEdit && esign.status !== "signed" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={refresh}>
            状態を更新
          </Button>
        )}
        {esign && canEdit && esign.status === "signed" && status === "open" && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={refresh}>
            成約に反映
          </Button>
        )}
        {DEMO && esign && (esign.status === "sent" || esign.status === "viewed") && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={demoSign}>
            （デモ）顧客が署名したことにする
          </Button>
        )}
      </div>
      {canRequest &&
        (mapped ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy} onClick={request}>
              {esign ? "契約書を作り直して送る" : "電子契約を送る"}
            </Button>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              メールでも送る
            </label>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {deal.planId ? "このプランに使う契約書が設定されていません（設定 → 電子契約）。" : "プランを決めると、電子契約を送れます。"}
          </p>
        ))}
    </section>
  );
}
