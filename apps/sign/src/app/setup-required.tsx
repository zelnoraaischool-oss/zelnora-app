import type { ConfigItem } from "@/lib/server/config-check";

/** 環境変数が足りないときの案内（Vercel につないだ直後など） */
export function SetupRequired({ missing }: { missing: ConfigItem[] }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">初期設定が必要です</h1>
      <p className="mb-4 text-sm text-slate-600">
        次の環境変数が設定されていません。Vercel の「Settings → Environment Variables」で設定し、再デプロイしてください。
        手順はリポジトリの <code>docs/vercel.md</code> にあります。
      </p>
      <ul className="space-y-2 rounded-xl bg-white p-4 text-sm ring-1 ring-slate-200">
        {missing.map((m) => (
          <li key={m.name}>
            <code className="font-semibold">{m.name}</code>
            <span className="ml-2 text-slate-600">{m.label}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
