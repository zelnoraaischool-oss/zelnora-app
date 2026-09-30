import { useEffect, useRef, useState } from "react";
import { DEMO, GOOGLE_CLIENT_ID } from "../lib/config";
import { demoUsers, resetDemo } from "../lib/demo";
import { Alert, Button } from "./ui";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; ux_mode?: string }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
          prompt(): void;
        };
      };
    };
  }
}

const ROLE_LABEL: Record<string, string> = { owner: "オーナー", admin: "管理者", manager: "マネージャー", sales: "営業担当", delivery: "提供担当", accounting: "経理", viewer: "閲覧者" };

export function Login({ onSignedIn }: { onSignedIn: (c: { email: string; idToken: string }) => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-bold">Zelnora</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">顧客・営業・提供・売上をひとつの画面で。</p>
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">{DEMO ? <DemoLogin onSignedIn={onSignedIn} /> : <GoogleLogin onSignedIn={onSignedIn} />}</div>
    </main>
  );
}

function GoogleLogin({ onSignedIn }: { onSignedIn: (c: { email: string; idToken: string }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(GOOGLE_CLIENT_ID ? null : "VITE_GOOGLE_CLIENT_ID が設定されていません");
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const g = window.google?.accounts.id;
      if (!g || !ref.current) return setError("Googleのログインを読み込めませんでした");
      g.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: true,
        callback: (r) => {
          try {
            const payload = JSON.parse(atob(r.credential.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { email: string };
            onSignedIn({ email: payload.email, idToken: r.credential });
          } catch {
            setError("ログインに失敗しました");
          }
        },
      });
      g.renderButton(ref.current, { theme: "outline", size: "large", text: "signin_with", locale: "ja", width: 280 });
      g.prompt();
    };
    s.onerror = () => setError("Googleのログインを読み込めませんでした");
    document.head.appendChild(s);
    return () => {
      s.remove();
    };
  }, [onSignedIn]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">許可されたGoogleアカウントでログインしてください。</p>
      <div ref={ref} />
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function DemoLogin({ onSignedIn }: { onSignedIn: (c: { email: string; idToken: string }) => void }) {
  const [users, setUsers] = useState(() => demoUsers());
  return (
    <div className="space-y-3">
      <Alert tone="warning">デモモードです。データはこのブラウザの中だけに保存されます。ロールを選んでお試しください。</Alert>
      <ul className="space-y-1.5">
        {users.map((u) => (
          <li key={u.email}>
            <button type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => onSignedIn({ email: u.email, idToken: "" })}>
              <span className="font-semibold">{u.name}</span>
              <span className="text-xs text-slate-500">{ROLE_LABEL[u.role] ?? u.role}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          resetDemo();
          setUsers(demoUsers());
        }}
      >
        デモのデータを初期状態に戻す
      </Button>
    </div>
  );
}
