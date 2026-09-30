"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContractBody } from "@/components/contract-body";
import { SignaturePad } from "@/components/signature-pad";
import { Alert, Button, cx, Field, Input } from "@/components/ui";
import { VariableInput } from "@/components/variable-input";
import { formatValue, validateValues } from "@/lib/contract/variables";
import { formatJst } from "@/lib/format";
import type { PublicInfo, SignerDocument } from "@/lib/server/signing";

type Step = "loading" | "error" | "verify" | "read" | "input" | "consent" | "sign" | "confirm" | "done" | "signed";

const STEPS: { id: Step; label: string }[] = [
  { id: "verify", label: "本人確認" },
  { id: "read", label: "内容確認" },
  { id: "input", label: "入力" },
  { id: "consent", label: "同意" },
  { id: "sign", label: "署名" },
  { id: "confirm", label: "最終確認" },
];

interface ApiError {
  ok: false;
  code?: string;
  error: string;
}

function useToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setToken(window.location.hash.replace(/^#/, "") || "");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return token;
}

export function SignerApp() {
  const token = useToken();
  const [step, setStepState] = useState<Step>("loading");
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [doc, setDoc] = useState<SignerDocument | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setStep = useCallback((s: Step) => {
    setError(null);
    setStepState(s);
  }, []);

  // 入力状態
  const [email, setEmail] = useState("");
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState<{ content: boolean; privacy: boolean; keyClauses: Record<string, boolean> }>({
    content: false,
    privacy: false,
    keyClauses: {},
  });
  const [signedName, setSignedName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [result, setResult] = useState<{ sha256: string; signedAt: string } | null>(null);

  const call = useCallback(
    async <T,>(action: string, body: object = {}): Promise<(T & { ok: true }) | ApiError> => {
      try {
        const res = await fetch(`/api/sign/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-sign-token": token ?? "" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        });
        const json = (await res.json()) as (T & { ok: true }) | ApiError;
        if (!json.ok && (json.code === "unverified" || json.code === "expired" || json.code === "revoked" || json.code === "canceled")) {
          if (json.code === "unverified") setStep("verify");
          else {
            setFatal(json.error);
            setStep("error");
          }
        }
        return json;
      } catch {
        return { ok: false, error: "通信できませんでした。電波の良いところで再度お試しください。" };
      }
    },
    [token, setStep],
  );

  const loadDocument = useCallback(async () => {
    const r = await call<{ document: SignerDocument }>("document");
    if (!r.ok) return false;
    const d = r.document;
    setDoc(d);
    setValues(Object.fromEntries(d.signerVariables.map((v) => [v.key, v.value])));
    if (d.status === "signed") setStep("signed");
    else setStep(d.readCompleted ? (d.signerVariables.length ? "input" : "consent") : "read");
    return true;
  }, [call, setStep]);

  // 1. URLを開く
  useEffect(() => {
    if (token === null) return;
    (async () => {
      if (!token) {
        setFatal("URLが正しくありません。メール等に記載のURLをもう一度開いてください。");
        setStep("error");
        return;
      }
      const res = await fetch("/api/sign/open", { method: "POST", headers: { "x-sign-token": token } });
      const r = (await res.json()) as { ok: true; info: PublicInfo } | { ok: false; message: string };
      if (!r.ok) {
        setFatal(r.message);
        setStep("error");
        return;
      }
      setInfo(r.info);
      if (r.info.verified) {
        if (!(await loadDocument())) setStep("verify");
      } else setStep("verify");
    })();
  }, [token, loadDocument, setStep]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const openPdf = (kind: "preview-pdf" | "final-pdf") =>
    run(async () => {
      const w = window.open("", "_blank");
      const res = await fetch(`/api/sign/${kind}`, { method: "POST", headers: { "x-sign-token": token ?? "" } });
      if (!res.ok) {
        w?.close();
        setError("PDFを取得できませんでした");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location.href = url;
      else window.location.href = url;
    });

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const signerVars = doc?.signerVariables ?? [];

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white pb-32 sm:my-6 sm:rounded-2xl sm:shadow-sm sm:ring-1 sm:ring-slate-200">
      <header className="border-b border-slate-200 px-4 py-4">
        <p className="text-xs text-slate-500">
          {info ? `${info.organizationName} との契約` : "電子契約"}
        </p>
        <h1 className="text-lg font-bold leading-snug">{info?.title ?? "契約書のご確認"}</h1>
        {stepIndex >= 0 && (
          <ol className="mt-3 flex gap-1" aria-label="進み具合">
            {STEPS.filter((s) => s.id !== "input" || signerVars.length > 0).map((s) => {
              const i = STEPS.findIndex((x) => x.id === s.id);
              return (
                <li key={s.id} className="flex-1">
                  <div className={cx("h-1.5 rounded-full", i <= stepIndex ? "bg-brand-600" : "bg-slate-200")} />
                  <span className={cx("mt-1 block text-center text-[10px]", i === stepIndex ? "font-bold text-brand-700" : "text-slate-400")}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </header>

      <main className="px-4 py-5">
        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {step === "loading" && <p className="py-20 text-center text-slate-500">読み込み中…</p>}

        {step === "error" && (
          <div className="py-10">
            <Alert tone="error">{fatal}</Alert>
          </div>
        )}

        {step === "verify" && info && (
          <section className="space-y-5">
            <div>
              <h2 className="text-base font-bold">ご本人確認</h2>
              <p className="mt-1 text-sm text-slate-600">
                契約書を表示する前に、メールアドレスに届く6桁の確認コードでご本人確認を行います。
              </p>
            </div>
            {!otpSentTo ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const r = await call<{ destination: string }>("otp-request", { email });
                    if (r.ok) setOtpSentTo(r.destination);
                    else setError(r.error);
                  });
                }}
              >
                {info.otpMode === "registered_email" ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm">
                    送信先：<span className="font-semibold">{info.emailHint}</span>
                  </p>
                ) : (
                  <Field label="メールアドレス" hint="この契約のご案内を受け取ったご本人のメールアドレスを入力してください">
                    <Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                )}
                <Button type="submit" className="w-full py-3 text-base" disabled={busy}>
                  {busy ? "送信中…" : "確認コードを送る"}
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const r = await call("otp-verify", { code });
                    if (!r.ok) return setError(r.error);
                    if (!(await loadDocument())) setError("契約書を読み込めませんでした");
                  });
                }}
              >
                <p className="text-sm">
                  <span className="font-semibold">{otpSentTo}</span> に確認コードを送りました（有効期限10分）。
                </p>
                <Field label="確認コード（6桁）">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    className="text-center text-2xl tracking-[0.5em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    autoFocus
                    required
                  />
                </Field>
                <Button type="submit" className="w-full py-3 text-base" disabled={busy || code.length !== 6}>
                  {busy ? "確認中…" : "確認する"}
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-sm text-slate-600 underline"
                  onClick={() => {
                    setOtpSentTo(null);
                    setCode("");
                  }}
                >
                  コードが届かない場合（再送）
                </button>
              </form>
            )}
            <p className="text-xs text-slate-500">
              有効期限：{formatJst(info.expiresAt)}（日本時間）
            </p>
          </section>
        )}

        {step === "read" && doc && (
          <ReadStep
            doc={doc}
            busy={busy}
            onPdf={() => openPdf("preview-pdf")}
            onNext={() =>
              run(async () => {
                const r = await call("read");
                if (!r.ok) return setError(r.error);
                setDoc({ ...doc, readCompleted: true });
                setStep(signerVars.length ? "input" : "consent");
              })
            }
          />
        )}

        {step === "input" && doc && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const check = validateValues(signerVars, values);
              setValueErrors(check.errors);
              if (Object.keys(check.errors).length) return;
              void run(async () => {
                const r = await call<{ values: Record<string, string> } | { errors: Record<string, string> }>("values", { values });
                if (!r.ok) return setError(r.error);
                if ("errors" in r) return setValueErrors(r.errors);
                setValues(r.values);
                setStep("consent");
              });
            }}
          >
            <h2 className="text-base font-bold">ご入力ください</h2>
            {signerVars.map((v) => (
              <VariableInput key={v.key} def={v} value={values[v.key] ?? ""} error={valueErrors[v.key]} onChange={(val) => setValues({ ...values, [v.key]: val })} />
            ))}
            <StickyBar>
              <Button type="button" variant="secondary" onClick={() => setStep("read")}>戻る</Button>
              <Button type="submit" className="flex-1 py-3 text-base" disabled={busy}>次へ</Button>
            </StickyBar>
          </form>
        )}

        {step === "consent" && doc && (
          <section className="space-y-4">
            <h2 className="text-base font-bold">同意事項の確認</h2>
            <Check checked={consents.content} onChange={(v) => setConsents({ ...consents, content: v })}>
              契約書の内容をすべて確認しました
            </Check>
            <Check checked={consents.privacy} onChange={(v) => setConsents({ ...consents, privacy: v })}>
              個人情報の取扱いに同意します（
              <a href={doc.privacyPolicyUrl ?? "/privacy"} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                プライバシーポリシー
              </a>
              ）
            </Check>
            {doc.keyClauses.length > 0 && (
              <div className="space-y-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                <p className="text-sm font-bold text-amber-900">特に重要な事項です。1つずつご確認ください。</p>
                {doc.keyClauses.map((k) => (
                  <Check
                    key={k.id}
                    checked={!!consents.keyClauses[k.id]}
                    onChange={(v) => setConsents({ ...consents, keyClauses: { ...consents.keyClauses, [k.id]: v } })}
                  >
                    <span className="font-semibold">{k.title}</span>
                    {k.description && <span className="block text-sm text-slate-700">{k.description}</span>}
                    <span className="block text-xs text-slate-500">確認しました</span>
                  </Check>
                ))}
              </div>
            )}
            <StickyBar>
              <Button variant="secondary" onClick={() => setStep(signerVars.length ? "input" : "read")}>戻る</Button>
              <Button
                className="flex-1 py-3 text-base"
                disabled={!consents.content || !consents.privacy || doc.keyClauses.some((k) => !consents.keyClauses[k.id])}
                onClick={() => setStep("sign")}
              >
                次へ
              </Button>
            </StickyBar>
          </section>
        )}

        {step === "sign" && doc && (
          <section className="space-y-4">
            <h2 className="text-base font-bold">署名</h2>
            <Field label="氏名を入力してください" hint={`この契約の署名者（${doc.signerName} 様）と同じ氏名を入力してください`} required>
              <Input autoComplete="name" value={signedName} onChange={(e) => setSignedName(e.target.value)} />
            </Field>
            <div>
              <span className="mb-1 block text-sm font-semibold text-slate-700">手書きサイン（任意）</span>
              <SignaturePad onChange={setSignature} />
            </div>
            <StickyBar>
              <Button variant="secondary" onClick={() => setStep("consent")}>戻る</Button>
              <Button className="flex-1 py-3 text-base" disabled={!signedName.trim()} onClick={() => setStep("confirm")}>
                最終確認へ
              </Button>
            </StickyBar>
          </section>
        )}

        {step === "confirm" && doc && (
          <ConfirmStep
            doc={doc}
            values={values}
            signedName={signedName}
            hasSignature={!!signature}
            busy={busy}
            onEdit={() => setStep(signerVars.length ? "input" : "sign")}
            onSubmit={() =>
              run(async () => {
                const r = await call<{ sha256: string; signedAt: string }>("finalize", { consents, signedName, signatureImage: signature });
                if (!r.ok) return setError(r.error);
                setResult({ sha256: r.sha256, signedAt: r.signedAt });
                setStep("done");
              })
            }
          />
        )}

        {step === "done" && result && (
          <section className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</div>
            <h2 className="text-xl font-bold">契約の締結が完了しました</h2>
            <p className="text-sm text-slate-600">
              確定版の契約書（合意締結証明書付き）を、ご本人確認に使ったメールアドレスへお送りしました。大切に保管してください。
            </p>
            <Button className="w-full py-3 text-base" disabled={busy} onClick={() => openPdf("final-pdf")}>
              確定版PDFを開く
            </Button>
            <div className="rounded-lg bg-slate-50 p-3 text-left text-xs text-slate-600">
              <div>締結日時：{formatJst(result.signedAt, { seconds: true })}（日本時間）</div>
              <div className="break-all">PDFのハッシュ値（SHA-256）：{result.sha256}</div>
              <div className="mt-1">
                改ざんされていないことは{" "}
                <a className="text-brand-700 underline" href="/verify" target="_blank">
                  検証ページ
                </a>{" "}
                で確認できます。
              </div>
            </div>
          </section>
        )}

        {step === "signed" && doc && (
          <section className="space-y-4">
            <Alert tone="success">この契約は {formatJst(doc.signedAt, { seconds: true })} に締結済みです（閲覧・ダウンロード専用）。</Alert>
            <Button className="w-full py-3 text-base" disabled={busy} onClick={() => openPdf("final-pdf")}>
              確定版PDFを開く
            </Button>
            {doc.documentSha256 && <p className="break-all text-xs text-slate-500">SHA-256：{doc.documentSha256}</p>}
            <div className="rounded-lg p-3 ring-1 ring-slate-200">
              <ContractBody doc={doc.body} />
            </div>
          </section>
        )}
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-slate-400">
        <a href={info?.privacyPolicyUrl ?? "/privacy"} target="_blank" rel="noreferrer" className="underline">
          プライバシーポリシー
        </a>
      </footer>
    </div>
  );
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-2xl gap-2">{children}</div>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1", checked ? "bg-brand-50 ring-brand-600" : "bg-white ring-slate-300")}>
      <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm leading-6">{children}</span>
    </label>
  );
}

function ReadStep({ doc, busy, onNext, onPdf }: { doc: SignerDocument; busy: boolean; onNext: () => void; onPdf: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const [reached, setReached] = useState(false);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setReached(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">契約書の内容</h2>
        <Button variant="secondary" className="min-h-9 px-3 py-1 text-xs" disabled={busy} onClick={onPdf}>
          PDFで見る
        </Button>
      </div>
      <p className="mb-3 text-sm text-slate-600">最後までスクロールしてご確認ください。</p>
      <article className="rounded-lg p-3 ring-1 ring-slate-200">
        <h1 className="mb-4 text-center text-base font-bold">{doc.title}</h1>
        <ContractBody doc={doc.body} />
      </article>
      <div ref={end} className="h-4" aria-hidden />
      <StickyBar>
        <Button className="flex-1 py-3 text-base" disabled={!reached || busy} onClick={onNext}>
          {reached ? "内容を確認しました。次へ" : "最後までスクロールしてください"}
        </Button>
      </StickyBar>
    </section>
  );
}

function ConfirmStep({
  doc,
  values,
  signedName,
  hasSignature,
  busy,
  onEdit,
  onSubmit,
}: {
  doc: SignerDocument;
  values: Record<string, string>;
  signedName: string;
  hasSignature: boolean;
  busy: boolean;
  onEdit: () => void;
  onSubmit: () => void;
}) {
  const entered = useMemo(() => doc.signerVariables.map((v) => ({ label: v.key, value: formatValue(v, values[v.key]) || "（未入力）" })), [doc, values]);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold">最終確認</h2>
        <p className="mt-1 text-sm text-slate-600">以下の内容で契約します。内容をご確認のうえ「この内容で契約する」を押してください。</p>
      </div>
      <dl className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        <Row label="契約の相手方" value={doc.organizationName} />
        <Row label="契約書" value={doc.title} />
        {doc.confirmItems.map((c) => (
          <Row key={c.key} label={c.label} value={c.text} strong />
        ))}
      </dl>
      <h3 className="text-sm font-bold">ご入力内容</h3>
      <dl className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {entered.map((e) => (
          <Row key={e.label} label={e.label} value={e.value} />
        ))}
        <Row label="署名（氏名）" value={signedName} />
        <Row label="手書きサイン" value={hasSignature ? "あり" : "なし"} />
        {doc.verifiedEmail && <Row label="本人確認済みメール" value={doc.verifiedEmail} />}
      </dl>
      <p className="text-xs text-slate-500">「この内容で契約する」を押すと、契約が成立し、確定版の契約書が作成されます。</p>
      <StickyBar>
        <Button variant="secondary" disabled={busy} onClick={onEdit}>
          修正する
        </Button>
        <Button className="flex-1 py-3 text-base" disabled={busy} onClick={onSubmit}>
          {busy ? "処理中…" : "この内容で契約する"}
        </Button>
      </StickyBar>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cx("whitespace-pre-line text-sm", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
