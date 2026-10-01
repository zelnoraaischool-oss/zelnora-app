# Vercel につなぐ手順

このリポジトリには、Vercel に別々のプロジェクトとして登録するアプリが2つあります。
どちらも Vercel の画面で「リポジトリを選ぶ → Root Directory を指定する」だけでビルドできるように設定済みです（`vercel.json`）。

| Vercel のプロジェクト | Root Directory | 中身 | 必要な外部サービス |
|---|---|---|---|
| **zelnora**（顧客管理の画面） | `apps/zelnora-web` | Zelnora の画面（Vite） | なし（API の URL を入れるまではデモで動く） |
| **zelnora-sign**（電子契約） | `apps/sign` | 電子契約（Next.js） | Supabase（DB・ログイン・保存）、Resend（メール） |

---

## A. Zelnora の画面（すぐに公開できます）

1. https://vercel.com/new →「Import Git Repository」で `zelnoraaischool-oss/zelnora-app` を選ぶ。
2. **Root Directory** に `apps/zelnora-web` を指定する（「Edit」から選択）。Framework は「Vite」が自動で選ばれます。ビルドの設定は変えなくて大丈夫です。
3. 「Deploy」。→ 表示された URL を開くと、**デモモード**（ブラウザ内にサンプルデータ）で動きます。
4. 本番のデータ（スプレッドシート）につなぐときは、Apps Script を設定してから（[zelnora-setup.md](zelnora-setup.md) の2章）、Vercel の「Settings → Environment Variables」に次を入れて再デプロイします。

| 名前 | 値 |
|---|---|
| `VITE_API_URL` | Apps Script のウェブアプリの URL（`https://script.google.com/macros/s/…/exec`） |
| `VITE_GOOGLE_CLIENT_ID` | Google Cloud の OAuth クライアントID |

- OAuth クライアントの「承認済みの JavaScript 生成元」に、Vercel の URL（例 `https://zelnora.vercel.app`、独自ドメインならそれも）を追加してください。
- Apps Script のスクリプトプロパティ `APP_URL` にも同じ URL を入れます（通知のリンクに使います）。

## B. 電子契約（Supabase と Resend を先に用意します）

### 1. Supabase（DB・管理者ログイン・PDFの保存）

1. https://supabase.com でプロジェクトを作成（リージョンは Tokyo）。
2. DB にスキーマを入れる。**SQL Editor** で、次の2つのファイルの中身を**この順に**貼り付けて実行します。
   1. `apps/sign/supabase/migrations/20260930000000_init.sql`
   2. `apps/sign/supabase/migrations/20261001000000_integration_and_import.sql`

   （コマンドで行う場合：`for f in apps/sign/supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done`）
3. Authentication → Providers → Email を有効、Authentication → Multi-Factor で **TOTP** を有効にする。
4. 次の値を控える。
   - Project Settings → Database → Connection string（**Transaction pooler**・port 6543）→ `DATABASE_URL`
   - Project Settings → API → Project URL → `NEXT_PUBLIC_SUPABASE_URL`、anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`、service_role key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Resend（メール）

1. https://resend.com で送信用ドメインを追加し、SPF・DKIM・DMARC の DNS を設定する。
2. API キーを作成 → `RESEND_API_KEY`。送信元（例 `電子契約 <no-reply@sign.example.jp>`）→ `MAIL_FROM`。

### 3. Vercel のプロジェクト

1. https://vercel.com/new で同じリポジトリをもう一度インポートし、**Root Directory** を `apps/sign` にする（Framework は Next.js が自動で選ばれます）。
2. **Environment Variables** に次を入れる（説明は [`apps/sign/.env.example`](../apps/sign/.env.example)）。

| 名前 | 値 |
|---|---|
| `APP_URL` | このプロジェクトの URL（例 `https://zelnora-sign.vercel.app`。独自ドメインならそれ） |
| `DATABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase で控えた値 |
| `RESEND_API_KEY` / `MAIL_FROM` | Resend の値 |
| `SESSION_SECRET` / `OTP_SECRET` / `TOKEN_ENCRYPTION_KEY` / `CRON_SECRET` | それぞれ `openssl rand -base64 32` で作った値（**後から変えない**） |
| `TSA_URL` | タイムスタンプ局。まずは `https://freetsa.org/tsr`（無償）。本番は認定事業者を推奨 |

3. 「Deploy」。
4. 確認：`https://<URL>/api/health` が `{"ok":true,…}` になれば設定は完了です。
   足りない設定があると、`/login` に「初期設定が必要です」と、足りない環境変数の名前が表示されます。
5. 最初のオーナーを登録する（手元のPCで1回だけ）。
   ```bash
   cd apps/sign
   DATABASE_URL=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm bootstrap-owner you@example.com '12文字以上のパスワード'
   DATABASE_URL=... pnpm seed you@example.com   # 初期テンプレートと条項ライブラリ（任意）
   ```
6. `https://<URL>/login` でログインし、認証アプリ（Google Authenticator など）を登録します。

定期処理（期限切れ・リマインド・タイムスタンプの再試行・連携の再送）は `vercel.json` の Cron で1日1回動きます（Vercel が `CRON_SECRET` を付けて呼び出します）。

## C. 2つをつなぐ（電子契約 ↔ Zelnora）

[sign-setup.md の 4.2](sign-setup.md) のとおり、秘密値を2つ作って両方に設定します。

| どこに | 名前 | 値 |
|---|---|---|
| Vercel（電子契約） | `INTEGRATION_API_KEY` | 秘密値1 |
| Vercel（電子契約） | `INTEGRATION_WEBHOOK_SECRET` | 秘密値2 |
| Vercel（電子契約） | `INTEGRATION_WEBHOOK_URL` | Zelnora の Apps Script のウェブアプリの URL |
| Apps Script のスクリプトプロパティ | `ESIGN_API_KEY` | 秘密値1 |
| Apps Script のスクリプトプロパティ | `ESIGN_WEBHOOK_SECRET` | 秘密値2 |

最後に Zelnora の「設定 → 電子契約」で電子契約の URL（`APP_URL` と同じ）を入れ、「接続を確認してテンプレートを読み込む」→ プランごとにテンプレートを選んで保存します。

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| 電子契約の `/login` に「初期設定が必要です」 | 表示された環境変数を Vercel に追加して再デプロイ |
| `/api/health` の `database` が `error` | `DATABASE_URL`（Transaction pooler の URL・パスワード）と、マイグレーションの実行を確認 |
| Zelnora で Google ログインのボタンが出ない・エラー | OAuth クライアントの「承認済みの JavaScript 生成元」に Vercel の URL があるか |
| Zelnora の「接続を確認」でエラー | `ESIGN_API_KEY` と `INTEGRATION_API_KEY` が同じか、電子契約の URL が正しいか |
