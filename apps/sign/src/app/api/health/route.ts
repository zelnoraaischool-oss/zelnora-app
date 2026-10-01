import { NextResponse } from "next/server";
import { missingConfig } from "@/lib/server/config-check";

export const dynamic = "force-dynamic";

/** 動作確認用：未設定の環境変数の名前（値は返さない）とDBへの接続 */
export async function GET() {
  const missing = missingConfig().map((m) => m.name);
  let database: "ok" | "error" | "not_configured" = "not_configured";
  if (!missing.includes("DATABASE_URL")) {
    try {
      const { deps } = await import("@/lib/server/deps");
      await deps().db.one("select 1 as ok from public.settings limit 1");
      database = "ok";
    } catch {
      database = "error";
    }
  }
  const ok = missing.length === 0 && database === "ok";
  return NextResponse.json({ ok, missing, database }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
