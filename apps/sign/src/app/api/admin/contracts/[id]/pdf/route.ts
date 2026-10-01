import { sha256Hex } from "@/lib/crypto";
import { audit } from "@/lib/server/audit";
import { clientInfoFromHeaders, currentAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import type { ContractRow, DocumentRow } from "@/lib/server/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentAdmin();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const d = deps();
  const doc = await d.db.one<DocumentRow>("select * from public.documents where contract_id = $1 order by created_at limit 1", [id]);
  const contract = await d.db.one<ContractRow>("select * from public.contracts where id = $1", [id]);
  if (!doc || !contract) return new Response("Not found", { status: 404 });
  const bytes = await d.storage.read(doc.storage_path);
  if (sha256Hex(bytes) !== doc.sha256) return new Response("保存されたPDFのハッシュが記録と一致しません", { status: 500 });
  await audit(d.db, {
    contractId: id,
    actorType: "admin",
    actorId: actor.id,
    eventType: "document.downloaded",
    client: clientInfoFromHeaders(req.headers),
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${contract.title}.pdf`)}`,
      "Cache-Control": "no-store",
    },
  });
}
