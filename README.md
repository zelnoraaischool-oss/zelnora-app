# zelnora-app

AIエンジニアスクールの業務システム一式です。

| 名前 | 内容 | 構成 | 場所 |
|---|---|---|---|
| **電子契約システム** | 自社専用の電子契約。テンプレート管理（Wordの契約書から読み込み可）、URL・メールでの送付、メールOTPによる本人確認、確定版PDF（合意締結証明書付き）、RFC 3161 タイムスタンプ、ハッシュチェーンの監査ログ、検証ページ、既存の契約書（PDF）の格納、Zelnora との連携API | Next.js（App Router）＋ Supabase ＋ Vercel ＋ Resend | [`apps/sign`](apps/sign) |
| **Zelnora app** | 顧客・営業・提供・売上をひとつの画面で管理。スプレッドシートを正本にし、固定費0円で運用。契約手続きから電子契約を送り、署名完了で自動的に成約 | Google スプレッドシート ＋ Apps Script（API）＋ Cloudflare Pages（画面） | [`packages/zelnora-core`](packages/zelnora-core)（業務ロジック）<br>[`apps/zelnora-gas`](apps/zelnora-gas)（API）<br>[`apps/zelnora-web`](apps/zelnora-web)（画面） |

- 要件からの変更点・仮定：[`docs/DECISIONS.md`](docs/DECISIONS.md)
- 受け入れ基準と自動テストの対応：[`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)
- **Vercel につなぐ手順：[`docs/vercel.md`](docs/vercel.md)**
- 本番のセットアップと運用：[電子契約](docs/sign-setup.md) ／ [Zelnora](docs/zelnora-setup.md)

## すぐに試す

必要なもの：Node.js 22、pnpm 10、PostgreSQL 16（電子契約のみ）

```bash
pnpm install

# Zelnora（デモモード：ブラウザ内で動き、サンプルデータ入り）
pnpm --filter @zelnora/web dev          # http://localhost:5173 → ロールを選んでログイン

# 電子契約（ローカルのPostgreSQLと、開発用ログイン・開発用TSAで動かす）
cd apps/sign
DB=$(./scripts/dev-db.sh)                # ローカルDBを作成（Supabase相当のシム＋マイグレーション）
cat > .env.local <<ENV
APP_URL=http://localhost:3000
DATABASE_URL=$DB
AUTH_DRIVER=dev
STORAGE_DRIVER=local
TSA_URL=dev
ENV
DATABASE_URL=$DB AUTH_DRIVER=dev pnpm bootstrap-owner owner@example.com
DATABASE_URL=$DB pnpm seed               # 初期テンプレート（受講契約書）と条項ライブラリ
pnpm dev                                 # http://localhost:3000/login → owner@example.com
```

開発モードではメールを送らず、`apps/sign/.data/outbox.jsonl` に記録します（確認コードもここに出ます）。

## テスト

```bash
node scripts/check-generic.mjs           # コードに商材固有の語がないか（Zelnora 要件2.6）
pnpm -r typecheck
pnpm --filter @zelnora/sign db:test:start   # テスト用PostgreSQL（ローカル）を起動
pnpm -r test                             # 単体・DB・結合テスト
pnpm --filter @zelnora/web test:e2e      # Zelnora の画面のE2E（デモモード）
cd apps/sign && pnpm e2e:setup && pnpm test:e2e   # 電子契約の画面のE2E
```

CI（GitHub Actions）で同じ検査を実行します：[`.github/workflows/ci.yml`](.github/workflows/ci.yml)

## ディレクトリ構成

```
apps/
  sign/                 電子契約システム（Next.js）
    supabase/migrations/  DBのスキーマ・RLS・改ざん防止のトリガー
    src/lib/server/       サービス層（契約・署名フロー・通知・定期処理）
    src/lib/pdf/          確定版PDF・合意締結証明書の生成
    src/lib/tsa/          RFC 3161 タイムスタンプ
    tests/                単体・DB・結合（tests/db）・E2E（tests/e2e）
  zelnora-gas/          Zelnora の API（Apps Script に配置）
  zelnora-web/          Zelnora の画面（Cloudflare Pages に配置）
packages/
  zelnora-core/         Zelnora の業務ロジック（権限・自動処理・計上ルール等）
    templates/            商材テンプレート（スクール型・コンサル型・サブスク型・単発販売型）
docs/                   判断の記録・受け入れ基準・セットアップ手順
```
