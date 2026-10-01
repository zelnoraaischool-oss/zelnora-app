"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UrlShare } from "@/components/url-share";
import { Alert, Button, Card, Input } from "@/components/ui";
import { copyAsync } from "@/lib/clipboard";
import { formatJst } from "@/lib/format";
import { cancelContractAction, getSigningUrlAction, reissueTokenAction, remindAction, revokeTokenAction } from "../../actions";

export function ContractActions({
  contractId,
  status,
  hasEmail,
  tokenState,
  hasDocument,
  imported = false,
}: {
  contractId: string;
  status: string;
  hasEmail: boolean;
  tokenState: { expiresAt: string; revoked: boolean } | null;
  hasDocument: boolean;
  imported?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"" | "cancel" | "revoke" | "reissue">("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(14);
  const [resend, setResend] = useState(hasEmail);
  const open = status === "sent" || status === "viewed";
  const canReissue = open || status === "expired";

  const act = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ tone: "success", text: success });
        setMode("");
        setReason("");
        if (typeof r.url === "string") setUrl(r.url);
        router.refresh();
      } else setMsg({ tone: "error", text: r.error ?? "失敗しました" });
    });

  return (
    <Card title="操作">
      <div className="space-y-3">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {tokenState && (
          <p className="text-xs text-slate-500">
            署名URL：{tokenState.revoked ? "無効" : `有効（${formatJst(tokenState.expiresAt)}まで）`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {open && tokenState && !tokenState.revoked && (
            <Button
              onClick={() =>
                start(async () => {
                  const p = getSigningUrlAction(contractId).then((r) => {
                    if (!r.ok) throw new Error(r.error);
                    setUrl(r.url);
                    return r.url;
                  });
                  const ok = await copyAsync(p);
                  await p.catch((e: Error) => setMsg({ tone: "error", text: e.message }));
                  if (ok) setMsg({ tone: "success", text: "署名URLをコピーしました" });
                })
              }
              disabled={pending}
            >
              URLを再コピー
            </Button>
          )}
          {open && hasEmail && (
            <Button variant="secondary" disabled={pending} onClick={() => act(() => remindAction(contractId), "リマインドを送信しました")}>
              リマインドを送信
            </Button>
          )}
          {canReissue && (
            <Button variant="secondary" disabled={pending} onClick={() => setMode(mode === "reissue" ? "" : "reissue")}>
              URLを再発行
            </Button>
          )}
          {open && tokenState && !tokenState.revoked && (
            <Button variant="secondary" disabled={pending} onClick={() => setMode(mode === "revoke" ? "" : "revoke")}>
              URLを無効化
            </Button>
          )}
          {(open || status === "expired") && (
            <Button variant="danger" disabled={pending} onClick={() => setMode(mode === "cancel" ? "" : "cancel")}>
              取り消す
            </Button>
          )}
          {hasDocument && (
            <a
              className="inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-600"
              href={`/api/admin/contracts/${contractId}/pdf`}
            >
              {imported ? "原本のPDFをダウンロード" : "確定版PDFをダウンロード"}
            </a>
          )}
        </div>
        {mode === "reissue" && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="text-sm">現在のURLを無効にして、新しいURLを発行します。</p>
            <label className="flex items-center gap-2 text-sm">
              有効期限
              <Input type="number" className="w-24" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />日
            </label>
            {hasEmail && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} /> 新しいURLをメールで送る
              </label>
            )}
            <Button disabled={pending} onClick={() => act(() => reissueTokenAction(contractId, days, resend), "URLを再発行しました")}>
              再発行する
            </Button>
          </div>
        )}
        {(mode === "cancel" || mode === "revoke") && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="text-sm">
              {mode === "cancel" ? "署名前の契約を取り消します。URLは即座に無効になります。" : "現在の署名URLを無効にします（再発行できます）。"}
            </p>
            <Input placeholder="理由（必須）" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              variant="danger"
              disabled={pending || !reason.trim()}
              onClick={() =>
                act(
                  () => (mode === "cancel" ? cancelContractAction(contractId, reason) : revokeTokenAction(contractId, reason)),
                  mode === "cancel" ? "契約を取り消しました" : "URLを無効化しました",
                )
              }
            >
              {mode === "cancel" ? "取り消す" : "無効化する"}
            </Button>
          </div>
        )}
        {url && <UrlShare url={url} copied />}
      </div>
    </Card>
  );
}
