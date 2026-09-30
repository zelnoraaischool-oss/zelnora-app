import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import { listClauses } from "@/lib/server/templates";
import { ClauseLibrary } from "./library";

export const metadata = { title: "条項ライブラリ" };

export default async function ClausesPage() {
  await requireAdmin({ owner: true });
  const clauses = await listClauses(deps().db);
  return (
    <>
      <PageHeader title="条項ライブラリ" description="よく使う条項を部品として保存し、テンプレートの編集画面から挿入できます。" />
      <ClauseLibrary clauses={clauses.map((c) => ({ id: c.id, name: c.name, category: c.category, body: c.body }))} />
    </>
  );
}
