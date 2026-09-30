import { can, type Role, ROLE_LABELS } from "@zelnora/core";
import { useState } from "react";
import { Alert, Button, Card, downloadText, Field, Input, Textarea } from "../../components/ui";
import { call, useApi } from "../../lib/api";
import { useSession } from "../../lib/session";

export function GeneralSettings() {
  const s = useSession();
  const [f, setF] = useState({
    organizationName: s.settings.organizationName,
    allowedDomains: s.settings.allowedDomains.join(", "),
    slackWebhook: s.settings.notifications.slackWebhook,
    googleChatWebhook: s.settings.notifications.googleChatWebhook,
    email: s.settings.notifications.email,
    maskedFields: s.settings.maskedFields,
  });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const owner = can(s.user, "settings.sources");
  const masked = (field: "email" | "phone") => f.maskedFields.find((m) => m.field === field)?.roles ?? [];
  const toggleMask = (field: "email" | "phone", role: Role, on: boolean) => {
    const rest = f.maskedFields.filter((m) => m.field !== field);
    const roles = on ? [...masked(field), role] : masked(field).filter((r) => r !== role);
    setF({ ...f, maskedFields: [...rest, { field, roles }] });
  };
  return (
    <Card title="基本設定">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="事業者名">
          <Input value={f.organizationName} onChange={(e) => setF({ ...f, organizationName: e.target.value })} />
        </Field>
        <Field label="ログインを許可するドメイン（カンマ区切り）" hint="未登録でも、このドメインのアカウントは閲覧者としてログインできます">
          <Input disabled={!owner} value={f.allowedDomains} onChange={(e) => setF({ ...f, allowedDomains: e.target.value })} />
        </Field>
        <Field label="Slack の Incoming Webhook URL">
          <Input disabled={!owner} value={f.slackWebhook} onChange={(e) => setF({ ...f, slackWebhook: e.target.value })} />
        </Field>
        <Field label="Google Chat の Webhook URL">
          <Input disabled={!owner} value={f.googleChatWebhook} onChange={(e) => setF({ ...f, googleChatWebhook: e.target.value })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={!owner} checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} />
        通知を担当者にメールでも送る（Googleアカウントの送信上限にご注意ください）
      </label>
      <div className="mt-4">
        <p className="mb-1 text-sm font-semibold">連絡先を伏せるロール</p>
        {(["email", "phone"] as const).map((field) => (
          <div key={field} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-16">{field === "email" ? "メール" : "電話"}</span>
            {(Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "owner").map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input type="checkbox" checked={masked(field).includes(r)} onChange={(e) => toggleMask(field, r, e.target.checked)} />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button
        className="mt-4"
        onClick={async () => {
          try {
            await call("settings.update", {
              organizationName: f.organizationName,
              maskedFields: f.maskedFields,
              ...(owner ? { allowedDomains: f.allowedDomains.split(/[,\s]+/).filter(Boolean), notifications: { slackWebhook: f.slackWebhook, googleChatWebhook: f.googleChatWebhook, email: f.email } } : {}),
            });
            setMsg({ tone: "success", text: "保存しました" });
            await s.reload();
          } catch (e) {
            setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
          }
        }}
      >
        保存
      </Button>
    </Card>
  );
}

export function VersionsSettings() {
  const s = useSession();
  const { data, reload } = useApi<{ version: number; at: string; by: string; comment: string }[]>("settings.versions");
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      await reload();
      await s.reload();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="設定の版">
        <table className="w-full text-sm">
          <tbody>
            {(data ?? []).map((v) => (
              <tr key={v.version} className="border-t border-slate-100">
                <td className="py-1 font-semibold">第{v.version}版</td>
                <td className="py-1 text-xs tabular-nums">{v.at.slice(0, 16).replace("T", " ")}</td>
                <td className="py-1 text-xs">{s.userName(v.by)}</td>
                <td className="py-1 text-xs">{v.comment}</td>
                <td className="py-1 text-right">
                  {v.version !== s.settings.version && (
                    <Button size="sm" variant="ghost" onClick={() => confirm(`第${v.version}版の設定に戻しますか？（戻したことも新しい版として残ります）`) && run(() => call("settings.restore", { version: v.version }), `第${v.version}版に戻しました`)}>
                      この版に戻す
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="設定の書き出しと読み込み（JSON）">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => downloadText(`zelnora-settings-v${s.settings.version}.json`, await call<string>("settings.export"), "application/json")}>
            書き出す
          </Button>
        </div>
        {can(s.user, "settings.sources") && (
          <div className="mt-3 space-y-2">
            <Textarea rows={4} placeholder="書き出したJSONを貼り付け" value={json} onChange={(e) => setJson(e.target.value)} />
            <Button disabled={!json} onClick={() => confirm("現在の設定を、貼り付けたJSONで置き換えますか？") && run(() => call("settings.import", { json }), "読み込みました")}>
              読み込む
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
