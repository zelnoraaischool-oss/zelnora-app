import Link from "next/link";
import { Alert, Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { formatJst } from "@/lib/format";
import { COURSE_TEMPLATE_NAME } from "@/lib/seed/course-contract";
import { requireAdmin } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import { listTemplates } from "@/lib/server/templates";
import { createTemplateAction, seedCourseTemplateAction } from "../actions";

export const metadata = { title: "テンプレート" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ error?: string; archived?: string }> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const templates = await listTemplates(deps().db, { includeArchived: showArchived });
  const hasCourse = templates.some((t) => t.name === COURSE_TEMPLATE_NAME);
  return (
    <>
      <PageHeader title="テンプレート" description="契約書のひな形。公開した版だけが契約の作成に使えます。" />
      {sp.error && (
        <div className="mb-4">
          <Alert tone="error">{sp.error}</Alert>
        </div>
      )}
      {actor.role === "owner" && (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card title="新しいテンプレート">
            <form action={createTemplateAction} className="flex flex-col gap-2 sm:flex-row">
              <Input name="name" placeholder="テンプレート名（例：業務委託契約書）" required />
              <Button type="submit">作成</Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              お手元のWordの契約書（.docx）は、作成後の「本文」タブの「Wordの契約書から読み込む」で取り込めます。
              締結済みの契約書（PDF）の保管は「既存の契約書を格納」から。
            </p>
          </Card>
          {!hasCourse && (
            <Card title="初期テンプレート">
              <p className="mb-3 text-sm text-slate-600">「{COURSE_TEMPLATE_NAME}」と、よく使う条項（秘密保持など）を登録します。</p>
              <form action={seedCourseTemplateAction}>
                <Button type="submit" variant="secondary">
                  受講契約書を登録する
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}
      <Card>
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <Link href={`/admin/templates/${t.id}`} className="font-semibold text-brand-700 hover:underline">
                  {t.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {t.current_version_no ? <Badge tone="green">公開中 第{t.current_version_no}版</Badge> : <Badge tone="amber">未公開</Badge>}
                  {t.has_draft && <Badge tone="amber">下書きあり</Badge>}
                  {t.status === "archived" && <Badge tone="red">アーカイブ</Badge>}
                  <span>契約 {t.contract_count}件</span>
                  <span>更新 {formatJst(t.updated_at)}</span>
                </div>
              </div>
              {t.current_version_no && t.status === "active" && (
                <Link href={`/admin/contracts/new?template=${t.id}`} className="text-sm font-semibold text-brand-700">
                  契約を作成 →
                </Link>
              )}
            </li>
          ))}
          {templates.length === 0 && <li className="py-8 text-center text-sm text-slate-500">テンプレートはまだありません</li>}
        </ul>
        <div className="mt-2 text-right text-xs">
          <Link href={showArchived ? "/admin/templates" : "/admin/templates?archived=1"} className="text-slate-500 underline">
            {showArchived ? "アーカイブを隠す" : "アーカイブも表示"}
          </Link>
        </div>
      </Card>
    </>
  );
}
