import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { deps } from "@/lib/server/deps";
import { runMaintenance } from "@/lib/server/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 定期実行：タイムスタンプの再試行、期限切れ、自動リマインド、匿名化、日次ハッシュ */
export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await runMaintenance(deps());
  return NextResponse.json({ ok: true, ...result });
}
