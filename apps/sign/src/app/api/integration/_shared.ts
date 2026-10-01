import { NextResponse } from "next/server";
import { deps } from "@/lib/server/deps";
import { checkApiKey, integrationEnabled } from "@/lib/server/integration";
import { AppError } from "@/lib/server/types";

/** 連携APIの共通処理：APIキーの確認と、エラーの形をそろえる */
export async function withIntegration(req: Request, fn: () => Promise<unknown>) {
  const d = deps();
  if (!integrationEnabled(d)) return NextResponse.json({ ok: false, error: "連携APIは無効です" }, { status: 404 });
  if (!checkApiKey(d, req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "APIキーが正しくありません" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, data: await fn() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status });
    console.error("[integration]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "サーバーでエラーが発生しました" }, { status: 500 });
  }
}
