"use client";

import { useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { DocxImportResult } from "@/lib/contract/docx-import";
import { importDocxAction } from "../../actions";

/** Word（.docx）の契約書を読み込んで本文にする */
export function WordImport({ hasContent, onImported }: { hasContent: boolean; onImported: (r: DocxImportResult) => string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (input.current) input.current.value = "";
    if (hasContent && !window.confirm("今の本文を、読み込んだWordの内容で置き換えます。よろしいですか？")) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await importDocxAction(fd).catch(() => ({ ok: false as const, error: "読み込みに失敗しました。通信状況を確認してください。" }));
    setBusy(false);
    if (!r.ok) {
      setMsg({ tone: "error", text: r.error });
      return;
    }
    setMsg({ tone: "success", text: onImported(r) });
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          aria-label="Wordファイルを選ぶ"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button variant="secondary" type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "読み込み中…" : "Wordの契約書から読み込む"}
        </Button>
        <span className="text-xs text-slate-500">
          お手元の契約書（.docx）を本文にします。「第N条」は条番号の見出しに、{"{{氏名}}"} のような箇所は変数になります。
        </span>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
