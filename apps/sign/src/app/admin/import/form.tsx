"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { importContractAction } from "../actions";

const MAX_BYTES = 4 * 1024 * 1024;

function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export function ImportForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ contractId: string; sha256: string; timestamped: boolean; title: string } | null>(null);

  function onFile(f: File | null) {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      setError("ファイルが大きすぎます（4MBまで）。スキャンの解像度を下げて保存し直してください。");
      setFile(null);
      return;
    }
    if (f && !/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setError("PDFのファイルを選んでください（Wordの場合は「名前を付けて保存 → PDF」で書き出してください）");
      setFile(null);
      return;
    }
    setFile(f);
    // ファイル名を契約書の名前の初期値にする
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ""));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setError("ファイルを選んでください");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("file", file);
    fd.set("title", title);
    const r = await importContractAction(fd).catch(() => ({ ok: false as const, error: "送信に失敗しました。通信状況を確認してください。" }));
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDone({ contractId: r.contractId, sha256: r.sha256, timestamped: r.timestamped, title });
  }

  function reset() {
    formRef.current?.reset();
    setFile(null);
    setTitle("");
    setDone(null);
    setError(null);
  }

  if (done) {
    return (
      <Card title="格納しました">
        <div className="space-y-3 text-sm">
          <p>
            「{done.title}」を格納しました。{done.timestamped ? "タイムスタンプも付与しました。" : "タイムスタンプは自動で再試行します。"}
          </p>
          <div>
            <div className="text-xs text-slate-500">SHA-256</div>
            <div className="break-all font-mono text-xs">{done.sha256}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white" href={`/admin/contracts/${done.contractId}`}>
              詳細を見る
            </Link>
            <Button variant="secondary" onClick={reset}>
              続けて格納する
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="max-w-2xl space-y-5">
      {error && <Alert tone="error">{error}</Alert>}
      <Card title="1. ファイル">
        <Field label="契約書のPDF" required hint="4MBまで。格納後は差し替え・削除ができません。">
          <input
            type="file"
            accept="application/pdf,.pdf"
            aria-label="契約書のPDF"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700"
          />
        </Field>
      </Card>
      <Card title="2. 契約の情報（検索に使います）">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="契約書の名前" required>
              <Input name="title_display" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </Field>
          </div>
          <Field label="相手方（会社名または氏名）" required>
            <Input name="counterpartyName" required maxLength={200} />
          </Field>
          <Field label="締結日" required>
            <Input name="signedDate" type="date" required max={todayJst()} />
          </Field>
          <Field label="署名した人の氏名" hint="連絡先に登録し、その人の契約として表示します">
            <Input name="signerName" maxLength={100} />
          </Field>
          <Field label="署名した人のメールアドレス">
            <Input name="signerEmail" type="email" maxLength={200} />
          </Field>
          <Field label="金額（円）">
            <Input name="amount" inputMode="numeric" placeholder="例：330000" />
          </Field>
          <Field label="取引年月日" hint="未入力なら締結日">
            <Input name="transactionDate" type="date" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="メモ">
              <Textarea name="note" rows={3} maxLength={2000} />
            </Field>
          </div>
        </div>
      </Card>
      <Button type="submit" disabled={busy || !file}>
        {busy ? "格納しています…" : "格納する"}
      </Button>
    </form>
  );
}
