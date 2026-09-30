import { resolveDocument, sanitizeDoc } from "@/lib/contract/document";
import { formatValue, parseVariableDefs, sampleValue } from "@/lib/contract/variables";
import { formatJstDate } from "@/lib/format";
import { renderContractPdf } from "@/lib/pdf/render";
import { currentAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

/** 編集中のテンプレートを、サンプル値を入れたPDFとしてプレビューする */
export async function POST(req: Request) {
  if (!(await currentAdmin())) return new Response("Unauthorized", { status: 401 });
  const input = (await req.json().catch(() => null)) as { title?: string; body?: unknown; variables?: unknown } | null;
  if (!input) return new Response("Bad request", { status: 400 });
  const settings = await getSettings(deps().db);
  const defs = parseVariableDefs(input.variables);
  const map = new Map(defs.map((d) => [d.key, d]));
  const system: Record<string, string> = {
    発注者名: settings.organization_name,
    契約ID: "00000000-0000-0000-0000-000000000000",
    契約締結日: formatJstDate(new Date()),
  };
  const body = resolveDocument(sanitizeDoc(input.body), (k) => system[k] ?? (map.has(k) ? formatValue(map.get(k), sampleValue(map.get(k)!)) : undefined));
  const pdf = await renderContractPdf({
    title: (input.title ?? "契約書").slice(0, 200),
    body,
    organizationName: settings.organization_name,
    preview: true,
  });
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
