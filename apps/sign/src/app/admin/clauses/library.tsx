"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ContractBody } from "@/components/contract-body";
import { type ClauseOption, RichEditor } from "@/components/editor/rich-editor";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { EMPTY_DOC, resolveDocument } from "@/lib/contract/document";
import { deleteClauseAction, saveClauseAction } from "../actions";

export function ClauseLibrary({ clauses }: { clauses: ClauseOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClauseOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        title="保存済みの条項"
        actions={
          <Button variant="secondary" onClick={() => setEditing({ id: "", name: "", category: "", body: EMPTY_DOC })}>
            ＋ 新しい条項
          </Button>
        }
      >
        <ul className="divide-y divide-slate-100">
          {clauses.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {c.category && <span className="mr-1 text-xs text-slate-500">［{c.category}］</span>}
                  {c.name}
                </span>
                <span className="flex gap-1">
                  <Button variant="ghost" onClick={() => setEditing(c)}>編集</Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      confirm(`「${c.name}」を削除しますか？（挿入済みのテンプレートには影響しません）`) &&
                      start(async () => {
                        await deleteClauseAction(c.id);
                        router.refresh();
                      })
                    }
                  >
                    削除
                  </Button>
                </span>
              </div>
              <div className="mt-1 max-h-24 overflow-hidden text-xs text-slate-500">
                <ContractBody doc={resolveDocument(c.body, () => undefined)} />
              </div>
            </li>
          ))}
          {clauses.length === 0 && <li className="py-6 text-center text-sm text-slate-500">まだありません</li>}
        </ul>
      </Card>
      {editing && (
        <Card title={editing.id ? "条項の編集" : "新しい条項"}>
          <div className="space-y-3">
            {error && <Alert tone="error">{error}</Alert>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="条項名" required>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="分類">
                <Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
              </Field>
            </div>
            <RichEditor key={editing.id || "new"} value={editing.body} onChange={(body) => setEditing((c) => (c ? { ...c, body } : c))} variableKeys={[]} clauses={[]} />
            <div className="flex gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveClauseAction({ id: editing.id || undefined, name: editing.name, category: editing.category, body: editing.body });
                    if (!r.ok) setError(r.error);
                    else {
                      setError(null);
                      setEditing(null);
                      router.refresh();
                    }
                  })
                }
              >
                保存
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                閉じる
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
