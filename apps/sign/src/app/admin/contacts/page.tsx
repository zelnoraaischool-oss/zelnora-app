import { Card, Input, PageHeader } from "@/components/ui";
import { formatJst } from "@/lib/format";
import { listContacts } from "@/lib/server/contacts";
import { deps } from "@/lib/server/deps";
import { ContactEditor } from "./editor";

export const metadata = { title: "連絡先" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const contacts = await listContacts(deps().db, sp.q ?? "");
  return (
    <>
      <PageHeader title="連絡先" description="契約を作成すると、署名者の情報がここに自動で登録・更新されます。" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form className="mb-3" action="/admin/contacts">
            <Input name="q" defaultValue={sp.q} placeholder="氏名・メール・会社名・タグで検索" />
          </form>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2">氏名</th>
                  <th className="px-2 py-2">連絡先</th>
                  <th className="px-2 py-2">会社名</th>
                  <th className="px-2 py-2">LINE</th>
                  <th className="px-2 py-2">タグ</th>
                  <th className="px-2 py-2">契約</th>
                  <th className="px-2 py-2">更新</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-semibold">
                      <ContactEditor contact={c} />
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {c.email}
                      <br />
                      {c.phone}
                    </td>
                    <td className="px-2 py-2">{c.company}</td>
                    <td className="px-2 py-2 text-xs">{c.line_user_id ? "LINE送信可" : "—"}</td>
                    <td className="px-2 py-2 text-xs">{c.tags.join("、")}</td>
                    <td className="px-2 py-2 text-xs">
                      {c.contract_count}件（署名済 {c.signed_count}）
                    </td>
                    <td className="px-2 py-2 text-xs">{formatJst(c.updated_at)}</td>
                  </tr>
                ))}
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      連絡先はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="連絡先を追加">
          <ContactEditor />
        </Card>
      </div>
    </>
  );
}
