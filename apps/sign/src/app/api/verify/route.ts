import { NextResponse } from "next/server";
import { deps } from "@/lib/server/deps";

export const dynamic = "force-dynamic";

/** ハッシュ値だけを受け取り、このシステムで締結された確定版PDFと一致するかを返す（PDF自体は受け取らない） */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sha256?: unknown };
  const sha = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return NextResponse.json({ ok: false, error: "SHA-256のハッシュ値（64桁の16進数）を指定してください" }, { status: 400 });
  }
  const row = await deps().db.one<{ contract_id: string; title: string; signed_at: string; tsa_time: string | null; kind: string }>(
    "select * from public.verify_document($1)",
    [sha],
  );
  if (!row) return NextResponse.json({ ok: true, match: false });
  return NextResponse.json({
    ok: true,
    match: true,
    signedAt: row.signed_at,
    timestampAt: row.tsa_time,
    contractId: row.contract_id,
    kind: row.kind,
  });
}
