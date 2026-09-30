"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { startEnrollAction, verifyMfaAction, type FormState } from "../actions";

export function MfaForm({ enrolled }: { enrolled: boolean }) {
  const [enroll, setEnroll] = useState<FormState | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, action, pending] = useActionState<FormState, FormData>(verifyMfaAction, {});
  const factorId = enroll?.factorId ?? state.factorId;

  if (!enrolled && !factorId) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          管理画面を使うには、スマートフォンの認証アプリ（Google Authenticator、Microsoft Authenticator など）の登録が必要です。
        </p>
        {enroll?.error && <Alert tone="error">{enroll.error}</Alert>}
        <Button className="w-full" disabled={starting} onClick={() => startTransition(async () => setEnroll(await startEnrollAction()))}>
          {starting ? "準備中…" : "認証アプリを登録する"}
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {enroll?.qr && (
        <div className="space-y-2 text-center">
          <p className="text-sm text-slate-700">認証アプリでQRコードを読み取ってください。</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="認証アプリ登録用のQRコード" className="mx-auto h-48 w-48" />
          <p className="break-all text-xs text-slate-500">読み取れない場合のキー：{enroll.secret}</p>
        </div>
      )}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="factorId" value={factorId ?? ""} />
      <Field label="認証アプリの6桁のコード">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "確認中…" : "確認する"}
      </Button>
    </form>
  );
}
