import type { DataSource, EntityName } from "@zelnora/core";
import { useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select } from "../../components/ui";
import { call } from "../../lib/api";
import { useSession } from "../../lib/session";

export const ENTITY_LABELS: Record<string, string> = {
  customers: "顧客",
  deals: "商談",
  deliveries: "提供",
  progress: "進捗項目",
  revenues: "売上台帳",
  activities: "活動記録",
  contracts: "契約",
  registrations: "登録",
  summary: "月次売上（書き出し先）",
  registry: "データソース一覧（書き出し先）",
};

const FIELD_HINTS: Partial<Record<EntityName, string[]>> = {
  customers: ["id", "name", "kana", "email", "phone", "company", "source", "status", "salesOwner", "note"],
  deals: ["id", "customerId", "productId", "planId", "stageId", "owner", "amount", "paymentMethod"],
  deliveries: ["id", "customerId", "productId", "planId", "owner", "startDate", "endDate", "status"],
  revenues: ["id", "customerId", "productId", "planId", "month", "amountExcl", "tax", "amountIncl", "status", "paidAt"],
};

/** データソース登録簿（10.4, ZN-SET-10） */
export function SourcesSettings() {
  const s = useSession();
  const [editing, setEditing] = useState<DataSource | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});
  return (
    <Card
      title="データソース登録簿"
      actions={
        <Button size="sm" onClick={() => setEditing({ id: `ds${Date.now().toString(36)}`, name: "", spreadsheetId: "", entity: "customers", sheetName: "", headerRow: 1, columns: { id: "ID" }, status: "check", lastCheckedAt: null, message: "" })}>
          ＋ 追加
        </Button>
      }
    >
      <p className="mb-2 text-xs text-slate-500">
        登録がないデータは、アプリ用のDBスプレッドシートに自動で保存します。既存のシートを使う場合は、項目と見出しの対応を登録してください（対応のない項目はDB側に保存します）。見出しが想定と違うと書き込みを止めて、オーナーに知らせます。
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">名前</th>
            <th className="py-1">用途</th>
            <th className="py-1">タブ</th>
            <th className="py-1">状態</th>
            <th className="py-1">最終確認</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.settings.dataSources.map((d) => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="py-2">
                <a className="text-brand-700 hover:underline" target="_blank" rel="noreferrer" href={`https://docs.google.com/spreadsheets/d/${d.spreadsheetId}`}>
                  {d.name}
                </a>
              </td>
              <td className="py-2">{ENTITY_LABELS[d.entity] ?? d.entity}</td>
              <td className="py-2">
                {d.sheetName}（見出し {d.headerRow}行目）
              </td>
              <td className="py-2">{d.status === "ok" ? <Badge tone="green">正常</Badge> : d.status === "check" ? <Badge tone="amber">要確認</Badge> : <Badge>停止</Badge>}</td>
              <td className="py-2 text-xs">
                {d.lastCheckedAt?.slice(0, 16).replace("T", " ")}
                {result[d.id] && <div className="text-slate-600">{result[d.id]}</div>}
              </td>
              <td className="py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await call<{ ok: boolean; message: string; headers: string[] }>("dataSources.test", { id: d.id, dataSource: d });
                    setResult({ ...result, [d.id]: `${r.message}（見出し：${r.headers.join("、")}）` });
                    await s.reload();
                  }}
                >
                  接続テスト
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                  編集
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.settings.dataSources.length === 0 && <p className="py-6 text-center text-sm text-slate-500">登録はありません（すべてアプリ用のDBに保存しています）</p>}
      {editing && <SourceDialog ds={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await s.reload(); }} />}
    </Card>
  );
}

function SourceDialog({ ds, onClose, onSaved }: { ds: DataSource; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<DataSource>(ds);
  const [cols, setCols] = useState<[string, string][]>(Object.entries(ds.columns));
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string; headers: string[] } | null>(null);
  const current = { ...d, columns: Object.fromEntries(cols.filter(([k, h]) => k && h)) };
  const hints = FIELD_HINTS[d.entity as EntityName] ?? [];
  return (
    <Modal
      open
      wide
      title="データソース"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                setTest(await call("dataSources.test", { dataSource: current }));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            接続テスト
          </Button>
          <Button
            onClick={async () => {
              try {
                await call("settings.saveDataSource", { dataSource: { ...current, status: test?.ok ? "ok" : current.status, lastCheckedAt: test ? new Date().toISOString() : current.lastCheckedAt } });
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            保存
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {test && <Alert tone={test.ok ? "success" : "warning"}>{`${test.message}\n見つかった見出し：${test.headers.join("、")}`}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="データソース名">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="例：顧客管理シート" />
        </Field>
        <Field label="スプレッドシートのURLまたはID" hint="システムアカウントに編集権限を共有してください">
          <Input value={d.spreadsheetId} onChange={(e) => setD({ ...d, spreadsheetId: e.target.value.trim().replace(/^.*\/spreadsheets\/d\/([^/]+).*$/, "$1") })} />
        </Field>
        <Field label="用途">
          <Select value={d.entity} onChange={(e) => setD({ ...d, entity: e.target.value as DataSource["entity"] })}>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="タブ名">
            <Input value={d.sheetName} onChange={(e) => setD({ ...d, sheetName: e.target.value })} />
          </Field>
          <Field label="見出しの行番号">
            <Input type="number" min={1} value={d.headerRow} onChange={(e) => setD({ ...d, headerRow: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="状態">
          <Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as DataSource["status"] })}>
            <option value="ok">正常</option>
            <option value="check">要確認</option>
            <option value="stopped">停止</option>
          </Select>
        </Field>
      </div>
      {!["summary", "registry"].includes(d.entity) && (
        <>
          <p className="text-sm font-semibold">列の対応（項目 → 見出し）</p>
          <p className="text-xs text-slate-500">「id」の列は必須です。主な項目：{hints.join("、")}</p>
          {cols.map(([k, h], i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input aria-label="項目" list="field-hints" value={k} onChange={(e) => setCols(cols.map((c, j) => (j === i ? [e.target.value, c[1]] : c)))} />
              <Input aria-label="見出し" list="header-hints" value={h} onChange={(e) => setCols(cols.map((c, j) => (j === i ? [c[0], e.target.value] : c)))} />
              <Button size="sm" variant="ghost" onClick={() => setCols(cols.filter((_, j) => j !== i))}>
                削除
              </Button>
            </div>
          ))}
          <datalist id="field-hints">
            {hints.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <datalist id="header-hints">
            {(test?.headers ?? []).map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <Button size="sm" variant="ghost" onClick={() => setCols([...cols, ["", ""]])}>
            ＋ 対応を追加
          </Button>
        </>
      )}
    </Modal>
  );
}
