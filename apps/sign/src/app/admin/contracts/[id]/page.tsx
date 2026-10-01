import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";
import { auditLabel, CHANNEL_LABELS } from "@/lib/audit-labels";
import { formatValue } from "@/lib/contract/variables";
import { formatJst, formatYen } from "@/lib/format";
import { getContractDetail } from "@/lib/server/contracts";
import { deps } from "@/lib/server/deps";
import { AppError } from "@/lib/server/types";
import { ContractActions } from "./actions-panel";

export const metadata = { title: "契約の詳細" };

function detailText(type: string, p: Record<string, unknown>): string {
  if (type === "contract.sent") return `送付方法：${CHANNEL_LABELS[String(p.channel)] ?? String(p.channel)}${p.reissued ? "（再発行）" : ""}`;
  if (type === "contract.canceled") return `理由：${String(p.reason ?? "")}`;
  if (type === "token.revoked") return `理由：${String(p.reason ?? "")}`;
  if (type === "token.issued" || type === "token.reissued") return `有効期限：${formatJst(String(p.expires_at))}`;
  if (type === "otp.requested") return `送信先：${String(p.destination ?? "")}`;
  if (type === "otp.verified") return `方法：メールのワンタイムパスワード（${String(p.destination ?? "")}）`;
  if (type === "otp.failed") return p.reason === "email_mismatch" ? `登録外のアドレス（${String(p.input)}）` : `残り${String(p.remaining ?? "")}回`;
  if (type === "values.saved") return Object.entries((p.values as Record<string, string>) ?? {}).map(([k, v]) => `${k}：${v}`).join(" / ");
  if (type === "consent.given") return String(p.summary ?? "");
  if (type === "contract.signed") return `署名：${String(p.signed_name ?? "")}${p.handwritten_signature ? "（手書きサインあり）" : ""}`;
  if (type === "document.generated" || type === "document.stored") return `SHA-256：${String(p.sha256 ?? "")}`;
  if (type === "contract.imported") return `相手方：${String(p.counterparty ?? "")}・締結日：${String(p.signed_date ?? "")}・${String(p.filename ?? "")}`;
  if (type === "integration.notified") return `イベント：${String(p.event ?? "")}`;
  if (type === "timestamp.granted") return `時刻：${formatJst(String(p.tsa_time), { seconds: true })}`;
  if (type === "timestamp.failed") return String(p.error ?? "");
  if (type === "notification.sent" || type === "notification.failed") return `${String(p.type)} → ${String(p.to ?? "")}${p.error ? `（${String(p.error)}）` : ""}`;
  if (type === "reminder.sent") return p.automatic ? "自動" : "手動";
  return "";
}

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await getContractDetail(deps().db, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const { contract, party, version, values, documents, timestamps, events, notifications, token, costYen } = detail;
  const status = contract.effective_status ?? contract.status;
  const defs = new Map((version?.variables ?? []).map((v) => [v.key, v]));
  const imported = contract.source === "imported";
  const pdfTs = timestamps.find((t) => t.target === "pdf");
  const contentTs = timestamps.find((t) => t.target === "content");
  const doc = documents[0];
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/admin" className="text-brand-700 hover:underline">
          ← 契約一覧
        </Link>
      </div>
      <PageHeader title={contract.title} description={<span className="flex items-center gap-2"><StatusBadge status={status} /> 契約ID {contract.id}</span>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ContractActions
            contractId={contract.id}
            status={status}
            hasEmail={!!party?.email}
            tokenState={token ? { expiresAt: token.expires_at, revoked: !!token.revoked_at } : null}
            hasDocument={!!doc}
            imported={imported}
          />
          <Card title="契約の内容">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">署名者</dt><dd className="font-semibold">{party?.name ?? "（未登録）"}</dd></div>
              <div><dt className="text-xs text-slate-500">メールアドレス</dt><dd>{party?.email ?? "（未登録）"}</dd></div>
              <div><dt className="text-xs text-slate-500">取引先</dt><dd>{contract.counterparty_name}</dd></div>
              <div><dt className="text-xs text-slate-500">金額</dt><dd>{formatYen(contract.amount) || "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">取引年月日</dt><dd>{contract.transaction_date ?? "—"}</dd></div>
              {imported ? (
                <>
                  <div><dt className="text-xs text-slate-500">締結日</dt><dd>{contract.signed_at ? formatJst(contract.signed_at).slice(0, 10) : "—"}</dd></div>
                  <div><dt className="text-xs text-slate-500">格納日時</dt><dd>{formatJst(contract.created_at)}</dd></div>
                </>
              ) : (
                <>
                  <div><dt className="text-xs text-slate-500">送付方法</dt><dd>{contract.delivery_channels.map((c) => CHANNEL_LABELS[c] ?? c).join("・")}</dd></div>
                  <div><dt className="text-xs text-slate-500">作成日時</dt><dd>{formatJst(contract.created_at)}</dd></div>
                  <div><dt className="text-xs text-slate-500">有効期限</dt><dd>{formatJst(contract.expires_at)}</dd></div>
                  <div><dt className="text-xs text-slate-500">署名日時</dt><dd>{formatJst(contract.signed_at, { seconds: true }) || "—"}</dd></div>
                </>
              )}
              {contract.external_ref && (
                <div><dt className="text-xs text-slate-500">連携元の識別子</dt><dd className="break-all font-mono text-xs">{contract.external_ref}</dd></div>
              )}
              {contract.note && (
                <div className="sm:col-span-2"><dt className="text-xs text-slate-500">メモ</dt><dd className="whitespace-pre-wrap">{contract.note}</dd></div>
              )}
              {contract.canceled_at && (
                <div><dt className="text-xs text-slate-500">取消</dt><dd>{formatJst(contract.canceled_at)}（{contract.cancel_reason}）</dd></div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">テンプレート</dt>
                {version ? (
                  <dd>
                    <Link className="text-brand-700 hover:underline" href={`/admin/templates/${version.template_id}`}>
                      {version.template_name}
                    </Link>{" "}
                    第{version.version_no}版
                    <span className="block break-all font-mono text-xs text-slate-500">本文ハッシュ {contract.template_body_hash}</span>
                  </dd>
                ) : (
                  <dd>なし（既存の契約書を格納）</dd>
                )}
              </div>
            </dl>
            {values.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1">項目</th><th className="py-1">値</th><th className="py-1">入力者</th></tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr key={v.variable_key} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-600">{v.variable_key}</td>
                      <td className="py-1 pr-2">{formatValue(defs.get(v.variable_key), v.value)}</td>
                      <td className="py-1 text-xs text-slate-500">{v.entered_by === "admin" ? "管理者" : "署名者"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="監査ログ（時系列・日本時間）">
            <ol className="relative space-y-3 border-l border-slate-200 pl-4">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-brand-600" />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs tabular-nums text-slate-500">{formatJst(e.created_at, { seconds: true })}</span>
                    <span className="font-semibold">{auditLabel(e.event_type)}</span>
                    <Badge>{e.actor_type === "admin" ? "管理者" : e.actor_type === "signer" ? "署名者" : "システム"}</Badge>
                  </div>
                  {detailText(e.event_type, e.payload) && <div className="break-all text-slate-600">{detailText(e.event_type, e.payload)}</div>}
                  {(e.ip || e.user_agent) && (
                    <div className="truncate text-xs text-slate-400" title={e.user_agent ?? ""}>
                      {e.ip} {e.user_agent}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={imported ? "原本（格納したPDF）・タイムスタンプ" : "確定版PDF・タイムスタンプ"}>
            {doc ? (
              <div className="space-y-3 text-sm">
                {doc.filename && (
                  <div>
                    <div className="text-xs text-slate-500">ファイル名</div>
                    <div className="break-all">{doc.filename}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-slate-500">SHA-256</div>
                  <div className="break-all font-mono text-xs">{doc.sha256}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">PDFへのタイムスタンプ</div>
                  {pdfTs ? (
                    <div>
                      <Badge tone="green">付与済み</Badge> {formatJst(pdfTs.tsa_time, { seconds: true })}
                      <div className="text-xs text-slate-500">{pdfTs.tsa_url}</div>
                      <a className="text-xs text-brand-700 underline" href={`/api/admin/contracts/${contract.id}/tsr`}>
                        タイムスタンプトークン（.tsr）をダウンロード
                      </a>
                    </div>
                  ) : (
                    <Badge tone="amber">未付与（自動で再試行中）</Badge>
                  )}
                </div>
                {contentTs && (
                  <div>
                    <div className="text-xs text-slate-500">契約内容へのタイムスタンプ</div>
                    <div>{formatJst(contentTs.tsa_time, { seconds: true })}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">署名が完了すると、確定版PDFが生成されます。</p>
            )}
          </Card>
          <Card title="通知の履歴">
            <ul className="space-y-2 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{n.type}</span>
                    <span className="block text-xs text-slate-500">
                      {formatJst(n.sent_at)} {n.recipient}
                    </span>
                    {n.error && <span className="block text-xs text-rose-600">{n.error}</span>}
                  </span>
                  <Badge tone={n.status === "failed" ? "red" : n.status === "logged" ? "amber" : "green"}>
                    {n.status === "failed" ? "失敗" : n.status === "logged" ? "記録のみ" : "送信"}
                  </Badge>
                </li>
              ))}
              {notifications.length === 0 && <li className="text-slate-500">まだありません</li>}
            </ul>
            <p className="mt-3 text-xs text-slate-500">この契約の従量費用：{costYen.toLocaleString("ja-JP")}円</p>
          </Card>
        </div>
      </div>
    </>
  );
}
