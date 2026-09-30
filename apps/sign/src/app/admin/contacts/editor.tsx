"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import type { ContactRow } from "@/lib/server/types";
import { saveContactAction } from "../actions";

export function ContactEditor({ contact }: { contact?: ContactRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(!contact);
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    company: contact?.company ?? "",
    tags: contact?.tags.join(", ") ?? "",
    note: contact?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="text-left text-brand-700 hover:underline" onClick={() => setOpen(true)}>
        {contact?.name}
      </button>
    );
  }
  return (
    <div className="min-w-60 space-y-2">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="氏名" required>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="メールアドレス">
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="電話番号">
        <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field label="会社名">
        <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
      </Field>
      <Field label="タグ（カンマ区切り）">
        <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      </Field>
      <Field label="メモ">
        <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveContactAction({
                id: contact?.id,
                name: form.name,
                email: form.email || null,
                phone: form.phone || null,
                company: form.company || null,
                tags: form.tags.split(/[,、]/),
                note: form.note,
              });
              if (!r.ok) return setError(r.error);
              setError(null);
              if (contact) setOpen(false);
              else setForm({ name: "", email: "", phone: "", company: "", tags: "", note: "" });
              router.refresh();
            })
          }
        >
          保存
        </Button>
        {contact && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            閉じる
          </Button>
        )}
      </div>
    </div>
  );
}
