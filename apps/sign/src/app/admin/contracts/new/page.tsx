import { Alert, LinkButton, PageHeader } from "@/components/ui";
import type { VariableDef } from "@/lib/contract/variables";
import { deps } from "@/lib/server/deps";
import { getSettings } from "@/lib/server/settings";
import { NewContractForm } from "./form";

export const metadata = { title: "新しい契約" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const d = deps();
  const sp = await searchParams;
  const templates = await d.db.query<{ id: string; name: string; description: string; version_no: number; variables: VariableDef[] }>(
    `select t.id, t.name, t.description, v.version_no, v.variables from public.templates t
     join public.template_versions v on v.id = t.current_version_id
     where t.status = 'active' order by t.updated_at desc`,
  );
  const settings = await getSettings(d.db);
  return (
    <>
      <PageHeader title="新しい契約" description="テンプレート → 署名者 → 送付方法 の順に入力します。" />
      {templates.length === 0 ? (
        <Alert tone="info">
          公開済みのテンプレートがありません。先にテンプレートを作成して公開してください。
          <div className="mt-2">
            <LinkButton href="/admin/templates">テンプレートへ</LinkButton>
          </div>
        </Alert>
      ) : (
        <NewContractForm templates={templates} defaultExpiryDays={settings.default_expiry_days} initialTemplateId={sp.template} />
      )}
    </>
  );
}
