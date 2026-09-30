import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import { getTemplate, listClauses } from "@/lib/server/templates";
import { AppError } from "@/lib/server/types";
import { TemplateEditor } from "./editor";

export const metadata = { title: "テンプレートの編集" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = deps();
  const t = await getTemplate(d.db, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const clauses = await listClauses(d.db);
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/admin/templates" className="text-brand-700 hover:underline">
          ← テンプレート一覧
        </Link>
      </div>
      <TemplateEditor
        key={t.draft?.id ?? t.current?.id}
        template={t.template}
        draft={t.draft}
        current={t.current}
        versions={t.versions.map((v) => ({ id: v.id, version_no: v.version_no, published_at: v.published_at, body_hash: v.body_hash, created_at: v.created_at }))}
        clauses={clauses.map((c) => ({ id: c.id, name: c.name, category: c.category, body: c.body }))}
        canEdit={actor.role === "owner"}
      />
    </>
  );
}
