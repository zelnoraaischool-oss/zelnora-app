"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import type { SettingsRow } from "@/lib/server/types";
import { inviteAdminAction, updateAdminAction, updateSettingsAction } from "../actions";

export function SettingsForm({ settings, editable }: { settings: SettingsRow; editable: boolean }) {
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (k: keyof SettingsRow) => ({
    value: String(s[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value }),
    inputMode: "decimal" as const,
  });
  return (
    <Card title="基本設定">
      <fieldset disabled={!editable} className="space-y-3">
        {!editable && <Alert tone="info">設定の変更はオーナーのみ可能です。</Alert>}
        <Field label="発注者名（契約書・署名画面に表示）" required>
          <Input value={s.organization_name} onChange={(e) => setS({ ...s, organization_name: e.target.value })} />
        </Field>
        <Field label="代表者">
          <Input value={s.organization_representative} onChange={(e) => setS({ ...s, organization_representative: e.target.value })} />
        </Field>
        <Field label="署名完了の通知先メール（管理者）" hint="署名が完了すると確定版PDFを送ります">
          <Input type="email" value={s.admin_notify_email ?? ""} onChange={(e) => setS({ ...s, admin_notify_email: e.target.value })} />
        </Field>
        <Field label="プライバシーポリシーのURL" hint="空欄の場合はこのシステムの /privacy を表示します">
          <Input value={s.privacy_policy_url ?? ""} onChange={(e) => setS({ ...s, privacy_policy_url: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="署名URLの有効期限（日）">
            <Input {...num("default_expiry_days")} />
          </Field>
          <Field label="送付後リマインド（日後）">
            <Input {...num("reminder_after_send_days")} />
          </Field>
          <Field label="期限前リマインド（日前）">
            <Input {...num("reminder_before_expiry_days")} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.auto_reminder_enabled} onChange={(e) => setS({ ...s, auto_reminder_enabled: e.target.checked })} />
          未署名の契約に自動でリマインドを送る
        </label>
        <Field label="未署名の契約（期限切れ・取消）の個人情報を匿名化するまでの日数" hint="署名済みの契約は匿名化・削除しません（7年以上保存）">
          <Input {...num("anonymize_after_days")} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.daily_hash_email_enabled} onChange={(e) => setS({ ...s, daily_hash_email_enabled: e.target.checked })} />
          1日1回、監査ログの最新ハッシュを通知先メールへ送る（外部に控えを残す）
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="メール単価（円）">
            <Input {...num("cost_email_yen")} />
          </Field>
          <Field label="SMS単価（円）">
            <Input {...num("cost_sms_yen")} />
          </Field>
          <Field label="タイムスタンプ単価（円）">
            <Input {...num("cost_timestamp_yen")} />
          </Field>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {editable && (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateSettingsAction(s);
                setMsg(r.ok ? { tone: "success", text: "保存しました" } : { tone: "error", text: r.error });
              })
            }
          >
            保存
          </Button>
        )}
      </fieldset>
    </Card>
  );
}

interface AdminItem {
  id: string;
  email: string;
  role: "owner" | "staff";
  mfa: boolean;
  disabled: boolean;
  created: string;
}

export function AdminsManager({ admins, me, editable }: { admins: AdminItem[]; me: string; editable: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (p: Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await p;
      setMsg(r.ok ? { tone: "success", text: ok } : { tone: "error", text: r.error ?? "失敗しました" });
      if (r.ok) router.refresh();
    });
  return (
    <Card title="管理者">
      <ul className="divide-y divide-slate-100 text-sm">
        {admins.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {a.email}
              <span className="ml-2 inline-flex gap-1">
                <Badge tone={a.role === "owner" ? "blue" : "slate"}>{a.role === "owner" ? "オーナー" : "スタッフ"}</Badge>
                {a.mfa ? <Badge tone="green">MFA登録済</Badge> : <Badge tone="amber">MFA未登録</Badge>}
                {a.disabled && <Badge tone="red">無効</Badge>}
              </span>
            </span>
            {editable && a.id !== me && (
              <span className="flex gap-1">
                <Button variant="ghost" disabled={pending} onClick={() => act(updateAdminAction(a.id, { role: a.role === "owner" ? "staff" : "owner" }), "変更しました")}>
                  {a.role === "owner" ? "スタッフにする" : "オーナーにする"}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => act(updateAdminAction(a.id, { disabled: !a.disabled }), "変更しました")}>
                  {a.disabled ? "有効にする" : "無効にする"}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">スタッフは契約の作成・閲覧のみ可能です（テンプレートの編集・削除、設定の変更はできません）。</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" placeholder="追加する管理者のメールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select className="sm:w-36" value={role} onChange={(e) => setRole(e.target.value as "owner" | "staff")}>
              <option value="staff">スタッフ</option>
              <option value="owner">オーナー</option>
            </Select>
            <Button disabled={pending || !email} onClick={() => act(inviteAdminAction({ email, role }), "招待しました")}>
              招待
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <div className="mt-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
    </Card>
  );
}
