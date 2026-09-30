"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { verifyAuditChainAction } from "../actions";

export function VerifyChain() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; checked: number; brokenSeq: string | null; reason: string | null; lastHash: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="ログの整合性チェック">
      <p className="mb-3 text-sm text-slate-600">
        すべての記録について、直前の記録とのハッシュのつながりと内容を再計算し、途中で書き換え・削除されていないかを確かめます。
      </p>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await verifyAuditChainAction();
            if (r.ok) {
              setResult(r.result);
              setError(null);
            } else setError(r.error);
          })
        }
      >
        {pending ? "確認中…" : "整合性をチェック"}
      </Button>
      <div className="mt-3">
        {error && <Alert tone="error">{error}</Alert>}
        {result &&
          (result.ok ? (
            <Alert tone="success">
              問題ありません（{result.checked.toLocaleString("ja-JP")}件を確認）。最新のハッシュ：
              <span className="break-all font-mono text-xs">{result.lastHash}</span>
            </Alert>
          ) : (
            <Alert tone="error">
              #{result.brokenSeq} で不整合を検知しました：{result.reason}
            </Alert>
          ))}
      </div>
    </Card>
  );
}
