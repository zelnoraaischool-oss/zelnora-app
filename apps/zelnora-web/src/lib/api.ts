import type { ApiResponse } from "@zelnora/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, DEMO } from "./config";
import { demoCall } from "./demo";

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly details?: unknown) {
    super(message);
  }
}

let credential: { email: string; idToken: string } | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCredential(c: { email: string; idToken: string } | null): void {
  credential = c;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: ApiResponse;
  if (DEMO) {
    if (!credential) throw new ApiError("ログインしてください", "unauthorized");
    res = await demoCall(credential.email, { action, params });
  } else {
    let r: Response;
    try {
      r = await fetch(API_URL, {
        method: "POST",
        // text/plain にして CORS のプリフライトを避ける（Apps Script はプリフライトに応答しない）
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ idToken: credential?.idToken ?? "", action, params }),
        redirect: "follow",
      });
    } catch {
      throw new ApiError("サーバーに接続できませんでした。通信状況を確認してください", "network");
    }
    res = (await r.json()) as ApiResponse;
  }
  if (!res.ok) {
    if (res.code === "unauthorized") onUnauthorized?.();
    throw new ApiError(res.error, res.code, res.details);
  }
  return res.data as T;
}

/** データの取得（再読み込み関数付き） */
export function useApi<T>(action: string | null, params: Record<string, unknown> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!action);
  const key = JSON.stringify([action, params]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!action) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await call<T>(action, JSON.parse(key)[1] as Record<string, unknown>);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e : new ApiError(String(e), "client"));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [action, key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}
