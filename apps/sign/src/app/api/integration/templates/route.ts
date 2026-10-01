import { deps } from "@/lib/server/deps";
import { listIntegrationTemplates } from "@/lib/server/integration";
import { withIntegration } from "../_shared";

export const dynamic = "force-dynamic";

/** 公開済みテンプレートと差し込み項目の一覧 */
export async function GET(req: Request) {
  return withIntegration(req, () => listIntegrationTemplates(deps().db));
}
