import { deps } from "@/lib/server/deps";
import { createIntegrationContract, getIntegrationStatus } from "@/lib/server/integration";
import { AppError } from "@/lib/server/types";
import { withIntegration } from "../_shared";

export const dynamic = "force-dynamic";

/** 契約の作成（同じ externalRef の署名待ち・署名済みの契約があればそれを返す） */
export async function POST(req: Request) {
  return withIntegration(req, async () => {
    const body = await req.json().catch(() => {
      throw new AppError("JSONの形式が正しくありません", "bad_request", 400);
    });
    return createIntegrationContract(deps(), body);
  });
}

/** 状態の確認：?contractId=... または ?externalRef=... */
export async function GET(req: Request) {
  return withIntegration(req, () => {
    const u = new URL(req.url);
    return getIntegrationStatus(deps(), { contractId: u.searchParams.get("contractId"), externalRef: u.searchParams.get("externalRef") });
  });
}
