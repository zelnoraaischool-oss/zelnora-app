import type { Product, Role, Settings, User } from "@zelnora/core";
import { labels as labelsOf } from "@zelnora/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { call, setCredential, setUnauthorizedHandler } from "./api";
import { DEMO, GOOGLE_CLIENT_ID } from "./config";

export interface SessionData {
  user: User;
  settings: Settings;
  users: { email: string; name: string; role: Role; productIds: string[]; active: boolean }[];
  templates: { templateType: string; label: string; description: string }[];
}

type LabelKey = "product" | "plan" | "customer" | "lead" | "deal" | "contract" | "registration" | "delivery" | "deliveryOwner" | "salesOwner" | "progressItem" | "activity" | "revenue" | "nextAction";
export type Labels = Record<LabelKey, string> & Record<string, string>;

interface SessionCtx extends SessionData {
  reload: () => Promise<void>;
  signOut: () => void;
  product: (id: string | null | undefined) => Product | undefined;
  labels: (productId?: string | null) => Labels;
  userName: (email: string | null | undefined) => string;
  activeProducts: Product[];
}

const Ctx = createContext<SessionCtx | null>(null);

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider がありません");
  return c;
}

const TOKEN_KEY = "zelnora.idToken";
const DEMO_KEY = "zelnora.demoUser";

function decodeJwt(token: string): { email?: string; exp?: number } {
  try {
    const part = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(part)))) as { email?: string; exp?: number };
  } catch {
    return {};
  }
}

function storedCredential(): { email: string; idToken: string } | null {
  try {
    if (DEMO) {
      const email = localStorage.getItem(DEMO_KEY);
      return email ? { email, idToken: "" } : null;
    }
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const p = decodeJwt(token);
    if (!p.email || !p.exp || p.exp * 1000 < Date.now() + 60_000) return null;
    return { email: p.email, idToken: token };
  } catch {
    return null;
  }
}

export function SessionProvider({ children, login }: { children: ReactNode; login: (onSignedIn: (c: { email: string; idToken: string }) => void) => ReactNode }) {
  const [cred, setCred] = useState(storedCredential);
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback((c: { email: string; idToken: string }) => {
    try {
      if (DEMO) localStorage.setItem(DEMO_KEY, c.email);
      else sessionStorage.setItem(TOKEN_KEY, c.idToken);
    } catch {
      // 保存できない環境ではこのタブの間だけ有効
    }
    setError(null);
    setCred(c);
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(DEMO_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // 無視
    }
    setCredential(null);
    setData(null);
    setCred(null);
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await call<SessionData>("session"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCred(null);
    }
  }, []);

  useEffect(() => {
    setCredential(cred);
    setUnauthorizedHandler(signOut);
    if (cred) void reload();
  }, [cred, reload, signOut]);

  const value = useMemo<SessionCtx | null>(() => {
    if (!data) return null;
    const product = (id: string | null | undefined) => data.settings.products.find((p) => p.id === id);
    return {
      ...data,
      reload,
      signOut,
      product,
      labels: (productId) => labelsOf(product(productId) ?? null) as Labels,
      userName: (email) => (email ? data.users.find((u) => u.email === email)?.name ?? email : "（未設定）"),
      activeProducts: data.settings.products.filter((p) => p.status === "active" && (["owner", "admin", "accounting"].includes(data.user.role) || data.user.productIds.includes(p.id))),
    };
  }, [data, reload, signOut]);

  if (!cred || (!value && error)) {
    return (
      <>
        {login(signIn)}
        {error && <p className="mx-auto mt-4 max-w-sm rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}
      </>
    );
  }
  if (!value) return <p className="p-10 text-center text-slate-500">読み込み中…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { GOOGLE_CLIENT_ID };
