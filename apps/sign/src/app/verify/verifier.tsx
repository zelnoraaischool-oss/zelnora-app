"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { formatJst } from "@/lib/format";

type Result = { match: false } | { match: true; signedAt: string; timestampAt: string | null; contractId: string; kind?: string };

async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function Verifier() {
  const [hash, setHash] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(h: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha256: h }),
      });
      const json = (await res.json()) as ({ ok: true } & Result) | { ok: false; error: string };
      if (!json.ok) setError(json.error);
      else setResult(json);
    } catch {
      setError("通信できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <Field label="PDFファイルを選ぶ">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              const h = await sha256OfFile(f);
              setHash(h);
              await check(h);
            }}
          />
        </Field>
        {fileName && <p className="mt-2 text-xs text-slate-500">{fileName}</p>}
      </div>
      <form
        className="rounded-xl bg-white p-4 ring-1 ring-slate-200"
        onSubmit={(e) => {
          e.preventDefault();
          void check(hash.trim().toLowerCase());
        }}
      >
        <Field label="またはハッシュ値（SHA-256）を入力">
          <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="64桁の16進数" className="font-mono text-xs" />
        </Field>
        <Button type="submit" className="mt-3" disabled={busy || !hash}>
          照合する
        </Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      {result &&
        (result.match ? (
          <Alert tone="success">
            {result.kind === "original" ? (
              <>
                <strong>このシステムに格納された既存の契約書（原本）と一致します。</strong>
                {"\n"}締結日：{formatJst(result.signedAt).slice(0, 10)}
                {"\n"}タイムスタンプは、格納した時点でこのファイルが存在したことを示します。
              </>
            ) : (
              <>
                <strong>このシステムで締結された契約書と一致します。</strong>
                {"\n"}締結日時：{formatJst(result.signedAt, { seconds: true })}（日本時間）
              </>
            )}
            {"\n"}タイムスタンプ時刻：{result.timestampAt ? `${formatJst(result.timestampAt, { seconds: true })}（日本時間）` : "付与待ち"}
            {"\n"}契約ID：{result.contractId}
          </Alert>
        ) : (
          <Alert tone="error">
            <strong>一致する契約書はありません。</strong>
            {"\n"}ファイルが確定版PDFでないか、内容が変更されている可能性があります。
          </Alert>
        ))}
    </div>
  );
}
