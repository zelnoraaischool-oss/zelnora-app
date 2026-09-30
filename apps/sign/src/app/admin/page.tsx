import Link from "next/link";
import { Alert, Button, Card, Input, LinkButton, PageHeader, Select, StatusBadge } from "@/components/ui";
import { formatJst, formatYen } from "@/lib/format";
import { dashboardCounts, searchContracts, usageCosts } from "@/lib/server/contracts";
import { deps } from "@/lib/server/deps";
import { listTemplates } from "@/lib/server/templates";

export const metadata = { title: "契約一覧" };

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const d = deps();
  const filters = {
    status: str(sp.status),
    q: str(sp.q),
    counterparty: str(sp.counterparty),
    dateFrom: str(sp.dateFrom),
    dateTo: str(sp.dateTo),
    amountMin: str(sp.amountMin).replace(/[,円]/g, ""),
    amountMax: str(sp.amountMax).replace(/[,円]/g, ""),
    templateId: str(sp.templateId),
    page: Number(str(sp.page)) || 1,
  };
  const [{ rows, total, page, pageSize }, { counts, timestampPending }, templates, costs] = await Promise.all([
    searchContracts(d.db, filters),
    dashboardCounts(d.db),
    listTemplates(d.db, { includeArchived: true }),
    usageCosts(d.db),
  ]);
  const cards = [
    { key: "sent", label: "送付済" },
    { key: "viewed", label: "閲覧済" },
    { key: "signed", label: "署名済" },
    { key: "expired", label: "期限切れ" },
    { key: "canceled", label: "取消" },
  ];
  const qs = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...patch })) if (v !== "" && v !== undefined) p.set(k, String(v));
    return `/admin?${p.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="契約一覧"
        description="ステータスの確認と、取引年月日・金額・取引先による検索ができます。"
        actions={<LinkButton href="/admin/contracts/new">＋ 新しい契約</LinkButton>}
      />
      {str(sp.error) === "forbidden" && (
        <div className="mb-4">
          <Alert tone="error">この操作はオーナーのみ実行できます。</Alert>
        </div>
      )}
      {timestampPending > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            タイムスタンプ未付与の確定版PDFが {timestampPending} 件あります。自動で再試行しています（一覧の「未付与」表示を確認してください）。
          </Alert>
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={qs({ status: filters.status === c.key ? "" : c.key, page: 1 })}
            className={`rounded-xl bg-white p-3 ring-1 ${filters.status === c.key ? "ring-2 ring-brand-600" : "ring-slate-200"}`}
          >
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="text-2xl font-bold">{counts[c.key] ?? 0}</div>
          </Link>
        ))}
      </div>

      <Card className="mb-5" title="検索">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" action="/admin">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">キーワード（件名・署名者）</span>
            <Input name="q" defaultValue={filters.q} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">取引先</span>
            <Input name="counterparty" defaultValue={filters.counterparty} />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">取引年月日</span>
            <div className="flex items-center gap-1">
              <Input type="date" name="dateFrom" defaultValue={filters.dateFrom} aria-label="取引年月日（から）" />
              <span>〜</span>
              <Input type="date" name="dateTo" defaultValue={filters.dateTo} aria-label="取引年月日（まで）" />
            </div>
          </div>
          <div className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">金額（円）</span>
            <div className="flex items-center gap-1">
              <Input inputMode="numeric" name="amountMin" defaultValue={filters.amountMin} placeholder="下限" aria-label="金額（下限）" />
              <span>〜</span>
              <Input inputMode="numeric" name="amountMax" defaultValue={filters.amountMax} placeholder="上限" aria-label="金額（上限）" />
            </div>
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">ステータス</span>
            <Select name="status" defaultValue={filters.status}>
              <option value="">すべて</option>
              {cards.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">テンプレート</span>
            <Select name="templateId" defaultValue={filters.templateId}>
              <option value="">すべて</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">検索</Button>
            <LinkButton href="/admin" variant="secondary">
              クリア
            </LinkButton>
          </div>
        </form>
      </Card>

      <Card title={`${total}件`}>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">ステータス</th>
                <th className="px-3 py-2">件名／署名者</th>
                <th className="px-3 py-2">テンプレート</th>
                <th className="px-3 py-2">取引先</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2">取引年月日</th>
                <th className="px-3 py-2">作成日</th>
                <th className="px-3 py-2">署名日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <StatusBadge status={r.effective_status ?? r.status} />
                    {r.timestamp_pending && <div className="mt-1 text-xs font-semibold text-amber-700">TS未付与</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/contracts/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {r.signer_name} {r.signer_email && `<${r.signer_email}>`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.template_name}
                    <span className="text-slate-400">（第{r.version_no}版）</span>
                  </td>
                  <td className="px-3 py-2">{r.counterparty_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(r.amount)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.transaction_date}</td>
                  <td className="px-3 py-2 tabular-nums">{formatJst(r.created_at)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatJst(r.signed_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                    該当する契約はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > pageSize && (
          <div className="mt-3 flex justify-between text-sm">
            {page > 1 ? <Link href={qs({ page: page - 1 })}>← 前へ</Link> : <span />}
            <span className="text-slate-500">
              {page} / {Math.ceil(total / pageSize)}
            </span>
            {page * pageSize < total ? <Link href={qs({ page: page + 1 })}>次へ →</Link> : <span />}
          </div>
        )}
      </Card>

      <Card className="mt-5" title={`今月の従量費用（${costs.month}）`}>
        <div className="flex flex-wrap gap-6 text-sm">
          {costs.items.map((i) => (
            <div key={i.label}>
              <div className="text-xs text-slate-500">{i.label}</div>
              <div className="font-semibold">
                {i.count}件 / {i.cost.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円
              </div>
            </div>
          ))}
          <div>
            <div className="text-xs text-slate-500">合計（契約1件あたり）</div>
            <div className="font-semibold">
              {costs.total.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円（
              {costs.perContract.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円／{costs.contractCount}件）
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">単価は「設定」で変更できます。</p>
      </Card>
    </>
  );
}
