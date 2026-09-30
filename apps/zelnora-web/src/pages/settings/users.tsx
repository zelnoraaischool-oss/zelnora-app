import { type Role, ROLE_LABELS, type User } from "@zelnora/core";
import { useState } from "react";
import { UserSelect } from "../../components/pickers";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select } from "../../components/ui";
import { call, useApi } from "../../lib/api";
import { useSession } from "../../lib/session";

export function UsersSettings() {
  const s = useSession();
  const { data, reload } = useApi<User[]>("users.list");
  const [editing, setEditing] = useState<User | null>(null);
  const [reassign, setReassign] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card
        title="利用者とロール"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setReassign(true)}>
              担当の一括付け替え
            </Button>
            <Button size="sm" onClick={() => setEditing({ id: "", email: "", name: "", role: "sales", productIds: [], active: true, capacity: null, createdAt: "" })}>
              ＋ 利用者を追加
            </Button>
          </>
        }
      >
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">名前</th>
              <th className="py-1">メール</th>
              <th className="py-1">ロール</th>
              <th className="py-1">担当商材</th>
              <th className="py-1">状態</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-2 font-semibold">{u.name}</td>
                <td className="py-2 text-xs">{u.email}</td>
                <td className="py-2">
                  <Badge tone="teal">{ROLE_LABELS[u.role]}</Badge>
                </td>
                <td className="py-2 text-xs">{["owner", "admin", "accounting"].includes(u.role) ? "すべて" : u.productIds.map((id) => s.product(id)?.name ?? id).join("、") || "（なし）"}</td>
                <td className="py-2">{u.active ? <Badge tone="green">有効</Badge> : <Badge>無効</Badge>}</td>
                <td className="py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                    編集
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">
          ログインできるのは、ここに登録された有効なGoogleアカウントと、基本設定で許可したドメインのアカウントだけです。スタッフにはスプレッドシート自体を共有せず、読み書きはアプリ経由に限ります。
        </p>
      </Card>
      {editing && (
        <UserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            await s.reload();
          }}
        />
      )}
      {reassign && (
        <ReassignDialog
          onClose={() => setReassign(false)}
          onDone={(t) => {
            setReassign(false);
            setMsg({ tone: "success", text: t });
          }}
        />
      )}
    </div>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const [u, setU] = useState(user);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={user.email ? `利用者：${user.name}` : "利用者を追加"}
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              await call("users.save", { user: u });
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Googleアカウントのメール" required>
          <Input type="email" disabled={!!user.email} value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} />
        </Field>
        <Field label="名前">
          <Input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} />
        </Field>
        <Field label="ロール">
          <Select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value as Role })}>
            {Object.entries(ROLE_LABELS)
              .filter(([k]) => s.user.role === "owner" || k !== "owner")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="担当数の上限（提供担当）">
          <Input type="number" value={u.capacity ?? ""} onChange={(e) => setU({ ...u, capacity: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </div>
      <Field label="担当商材" hint="オーナー・管理者・経理はすべての商材を扱えます">
        <div className="flex flex-wrap gap-3 text-sm">
          {s.settings.products.map((p) => (
            <label key={p.id} className="flex items-center gap-1">
              <input type="checkbox" checked={u.productIds.includes(p.id)} onChange={(e) => setU({ ...u, productIds: e.target.checked ? [...u.productIds, p.id] : u.productIds.filter((x) => x !== p.id) })} />
              {p.name}
            </label>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={u.active} onChange={(e) => setU({ ...u, active: e.target.checked })} /> 有効（ログインできる）
      </label>
    </Modal>
  );
}

/** 担当の一括付け替え（ZN-ROLE-04） */
function ReassignDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const s = useSession();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [productId, setProductId] = useState("");
  const [opts, setOpts] = useState({ deals: true, deliveries: true, customers: true });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title="担当の一括付け替え"
      onClose={onClose}
      footer={
        <Button
          onClick={async () => {
            try {
              const r = await call<{ deals: number; deliveries: number; customers: number }>("users.reassign", { reassign: { from, to, productId: productId || null, ...opts } });
              onDone(`商談 ${r.deals}件・提供 ${r.deliveries}件・顧客 ${r.customers}件 を移しました（監査ログに記録しました）`);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          移す
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-600">退職や異動のとき、ある担当者の進行中の商談と提供を、まとめて別の担当者へ移します。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="移す元">
          <UserSelect value={from} onChange={setFrom} allowEmpty />
        </Field>
        <Field label="移す先">
          <UserSelect value={to} onChange={setTo} allowEmpty />
        </Field>
        <Field label="商材">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">すべて</option>
            {s.settings.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-3 text-sm">
        {([
          ["deals", "商談"],
          ["deliveries", "提供"],
          ["customers", "顧客の担当営業"],
        ] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1">
            <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
            {l}
          </label>
        ))}
      </div>
    </Modal>
  );
}
