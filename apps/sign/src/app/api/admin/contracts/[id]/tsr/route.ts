import { currentAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import type { TimestampRow } from "@/lib/server/types";

export const dynamic = "force-dynamic";

/** PDFへのタイムスタンプトークン（RFC 3161 TimeStampToken, DER）。
 *  `openssl ts -verify -data 契約書.pdf -in token.tsr -token_in -CAfile TSAのCA証明書` で第三者が検証できる */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const ts = await deps().db.one<TimestampRow>(
    "select * from public.document_timestamps where contract_id = $1 and target = 'pdf' order by created_at limit 1",
    [id],
  );
  if (!ts) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(ts.tsa_token, "base64"), {
    headers: {
      "Content-Type": "application/timestamp-reply",
      "Content-Disposition": `attachment; filename="${id}.tsr"`,
      "Cache-Control": "no-store",
    },
  });
}
