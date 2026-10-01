# 電子契約システム：本番のセットアップと運用

## 1. 用意するもの（要件定義書10章）

- システム用の独自ドメイン（例：`sign.example.jp`）
- Supabase のプロジェクト（東京リージョン推奨）
- Vercel のプロジェクト
- Resend のアカウントと、SPF・DKIM・DMARC を設定した送信ドメイン
- タイムスタンプ局（本番は認定タイムスタンプ事業者を推奨。開発中は無償TSAでも可）
- プライバシーポリシーの文面（未設定の場合は `/privacy` の雛形を表示）

## 2. Supabase

1. プロジェクトを作成する。
2. SQLエディタ（または `supabase db push`）で `apps/sign/supabase/migrations/` のSQLを順に実行する。
   - `documents` バケット（非公開）が作られます。ポリシーは作らないため、署名済みPDFは管理画面・署名画面のサーバーからのみ扱えます。
3. Authentication → Providers で Email を有効にし、Authentication → Multi-Factor で **TOTP を有効** にする。
4. Authentication → URL Configuration の Site URL を本番のURLにする。
5. Project Settings → Database の「Transaction pooler」の接続文字列を `DATABASE_URL` に使う。

## 3. Vercel

1. リポジトリを接続し、Root Directory を `apps/sign` にする。
2. 環境変数を設定する（一覧と説明は [`apps/sign/.env.example`](../apps/sign/.env.example)）。`SESSION_SECRET`・`OTP_SECRET`・`TOKEN_ENCRYPTION_KEY`・`CRON_SECRET` は `openssl rand -base64 32` で作成し、**変更しないでください**（変えると発行済みのURLを再コピーできなくなります）。
3. 独自ドメインを割り当て、`APP_URL` をそのURLにする。
4. `vercel.json` の Cron が1日1回 `/api/cron/run` を呼びます。1時間ごとにしたい場合は、GitHub の Secrets に `SIGN_APP_URL` と `SIGN_CRON_SECRET` を設定すると `.github/workflows/sign-cron.yml` が動きます。

## 4. 最初のオーナーと初期テンプレート

```bash
cd apps/sign
DATABASE_URL=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm bootstrap-owner you@example.com '12文字以上のパスワード'
DATABASE_URL=... pnpm seed you@example.com
```

初回ログイン時に、認証アプリ（Google Authenticator など）の登録を求められます。スタッフは「設定 → 管理者」から招待します（スタッフは契約の作成・閲覧のみ）。

**初期テンプレート（受講契約書）は雛形です。** 既存の契約書の文言に差し替え、公開前に弁護士の確認を受けてください（`docs/DECISIONS.md` 1-19）。

お手元に Word の契約書（.docx）がある場合は、テンプレートを作成し、本文タブの「**Wordの契約書から読み込む**」で取り込めます（「第N条」は条番号の見出しに、`{{氏名}}` のように書いた箇所は変数になります）。読み込んだら、変数タブで種類と入力者を確認し、プレビューで確認してから公開してください。

## 4.1 既存の契約書を格納する

紙で締結した契約書や、他のサービスで締結した契約書は、PDFにして「**既存の契約書を格納**」から保管できます。

- 契約書の名前・相手方・締結日（必須）と、金額・取引年月日・署名した人（任意）を入力します。契約一覧で、ほかの契約と同じように検索できます（テンプレートの絞り込みで「既存の契約書（格納）」を選ぶと格納分だけ）。
- 格納したPDFは変更・削除できません。PDFのハッシュにタイムスタンプを付け、検証ページで照合できます（タイムスタンプは「格納した時点でこのファイルが存在した」ことを示します）。
- 1ファイル4MBまで。大きい場合はスキャンの解像度を下げてください。

## 4.2 Zelnora（顧客管理）との連携

Zelnora の「契約手続き」の段階から契約書を作成し、署名が完了したら Zelnora の商談を成約にします。

1. 秘密値を2つ作る：`openssl rand -base64 32` を2回。
2. 電子契約（Vercel）の環境変数：`INTEGRATION_API_KEY`＝1つ目、`INTEGRATION_WEBHOOK_SECRET`＝2つ目、`INTEGRATION_WEBHOOK_URL`＝Zelnora の Apps Script のウェブアプリのURL。
3. Zelnora の Apps Script のスクリプトプロパティ：`ESIGN_API_KEY`＝1つ目、`ESIGN_WEBHOOK_SECRET`＝2つ目。
4. Zelnora の「設定 → 電子契約」で、このシステムのURLを入れて「接続を確認してテンプレートを読み込む」→ プランごとにテンプレートと差し込む値を選んで保存。

通知が届かなかった場合も、Zelnora が15分ごとに状態を確認します。通知の再送は電子契約側の定期処理（`/api/cron/run`）で行います。

## 5. 日々の運用

| やること | 場所 |
|---|---|
| 契約の作成・URLのコピー・メール送信 | 管理画面 →「＋ 新しい契約」（1画面で完結）／ Zelnora の商談から（4.2） |
| 締結済みの契約書（PDF）の保管 | 管理画面 →「既存の契約書を格納」 |
| 未署名のリマインド | 自動（送付3日後・期限1日前。設定で変更可）／契約の詳細から手動 |
| URLの無効化・再発行・取消 | 契約の詳細 →「操作」 |
| タイムスタンプ未付与の確認 | 契約一覧の上部の警告（自動で再試行します） |
| 監査ログの整合性チェック | 管理画面 → 監査ログ →「整合性をチェック」 |
| 監査ログの控えをメールで残す | 設定 →「1日1回、監査ログの最新ハッシュを…」をオン |
| 従量費用の確認 | 契約一覧の下部・設定画面（単価は設定で変更） |
| 電子帳簿保存法の検索 | 契約一覧の検索（取引年月日・金額・取引先の範囲と組み合わせ） |

## 6. 第三者による検証

- **検証ページ** `/verify`：PDFを選ぶと、ブラウザの中でSHA-256を計算して照合します（PDFはサーバーに送られません）。
- **タイムスタンプ**：契約の詳細から `.tsr` をダウンロードし、TSAの証明書で検証できます。
  ```bash
  openssl ts -verify -data 契約書.pdf -in token.tsr -token_in -CAfile tsa-ca.pem -untrusted tsa.crt
  ```

## 7. バックアップ

Supabase の日次バックアップに加え、`.github/workflows/sign-backup.yml` が週1回 `pg_dump` を取ります（Secrets に `SIGN_BACKUP_DATABASE_URL` を設定）。
