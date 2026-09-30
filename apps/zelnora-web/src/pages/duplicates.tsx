import type { Customer } from "@zelnora/core";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Empty, Loading, Modal, PageHeader } from "../components/ui";
import { call, useApi } from "../lib/api";

type Group = { key: string; reason: "email" | "phone"; customerIds: string[]; customers: Customer[] };
const FIELDS = [
  ["name", "氏名"],
  ["kana", "ふりがな"],
  ["email", "メール"],
  ["phone", "電話"],
  ["company", "会社名"],
  ["source", "流入経路"],
  ["status", "状態"],
  ["salesOwner", "担当営業"],
  ["note", "メモ"],
] as const;

/** 重複の検出と統合（ZN-CUS-07） */
export function DuplicatesPage() {
  const { data, loading, error, reload } = useApi<Group[]>("customers.duplicates");
  const [merging, setMerging] = useState<[Customer, Customer] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="重複の確認" description="メールアドレスと電話番号を正規化して、同じ人の可能性がある組み合わせを表示します。" />
      {msg && <Alert tone="success">{msg}</Alert>}
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <Card>
          <Empty>重複の候補はありません</Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((g) => (
            <Card key={`${g.reason}:${g.key}`} title={<span>{g.reason === "email" ? "同じメール" : "同じ電話番号"}：<span className="font-mono text-xs">{g.key}</span></span>}>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.customers.map((c) => (
                  <div key={c.id} className="rounded-lg p-2 text-sm ring-1 ring-slate-200">
                    <Link to={`/customers/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {c.email} {c.phone} ・ 登録 {c.createdAt.slice(0, 10)}
                    </div>
                  </div>
                ))}
              </div>
              {g.customers.length >= 2 && (
                <Button className="mt-2" size="sm" onClick={() => setMerging([g.customers[0]!, g.customers[1]!])}>
                  統合する…
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      {merging && (
        <MergeDialog
          a={merging[0]}
          b={merging[1]}
          onClose={() => setMerging(null)}
          onDone={(name) => {
            setMerging(null);
            setMsg(`「${name}」に統合しました。統合前の状態は監査ログに残っています。`);
            void reload();
          }}
        />
      )}
    </>
  );
}

function MergeDialog({ a, b, onClose, onDone }: { a: Customer; b: Customer; onClose: () => void; onDone: (name: string) => void }) {
  const [primary, setPrimary] = useState<"a" | "b">(a.createdAt <= b.createdAt ? "a" : "b");
  const [pick, setPick] = useState<Record<string, "primary" | "secondary">>({});
  const [error, setError] = useState<string | null>(null);
  const P = primary === "a" ? a : b;
  const S = primary === "a" ? b : a;
  return (
    <Modal
      open
      wide
      title="顧客の統合"
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          onClick={async () => {
            try {
              const r = await call<Customer>("customers.merge", { primaryId: P.id, secondaryId: S.id, pick });
              onDone(r.name);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          統合する
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm">項目ごとに残す値を選んでください。商談・{"提供"}・売上・活動は、残す側に付け替えます。</p>
      <div className="flex gap-2 text-sm">
        残す側：
        <label className="flex items-center gap-1">
          <input type="radio" checked={primary === "a"} onChange={() => { setPrimary("a"); setPick({}); }} /> {a.name}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={primary === "b"} onChange={() => { setPrimary("b"); setPick({}); }} /> {b.name}
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">項目</th>
            <th className="py-1">
              残す側 <Badge tone="green">{P.name}</Badge>
            </th>
            <th className="py-1">
              統合される側 <Badge>{S.name}</Badge>
            </th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(([k, label]) => {
            const choose = pick[k] ?? (P[k] ? "primary" : "secondary");
            return (
              <tr key={k} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{label}</td>
                {(["primary", "secondary"] as const).map((side) => (
                  <td key={side} className="py-1">
                    <label className="flex items-center gap-1">
                      <input type="radio" name={k} checked={choose === side} onChange={() => setPick({ ...pick, [k]: side })} />
                      <span className="break-all">{String((side === "primary" ? P : S)[k] ?? "") || <span className="text-slate-300">（空）</span>}</span>
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
