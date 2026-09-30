"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { loginAction, type FormState } from "./actions";

export function LoginForm({ devMode }: { devMode: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="メールアドレス">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      {!devMode && (
        <Field label="パスワード">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "確認中…" : "ログイン"}
      </Button>
    </form>
  );
}
