# Zelnora app：本番のセットアップと運用

固定費0円（Googleアカウント＋スプレッドシート＋Apps Script＋Vercel または Cloudflare Pages の無料枠）で動かします。

## 1. システムアカウント（Apps Script を実行する唯一のアカウント）

スプレッドシートを直接編集できるのは、システムアカウントとオーナーだけにします（4章）。
Google Workspace のアカウントを推奨します（個人アカウントより Apps Script の実行上限が大きいため）。

## 2. Apps Script（API）

```bash
cd apps/zelnora-gas
npx clasp login                         # システムアカウントでログイン
npx clasp create --type standalone --title "Zelnora API" --rootDir dist
pnpm build                              # dist/Code.js と appsscript.json を作成（上書き）
npx clasp push
```

1. Apps Script のエディタで **`setup` を実行**する（DB用スプレッドシート「Zelnora DB」の作成、実行したアカウントをオーナーとして登録、15分ごと・毎日のトリガーの設定）。
2. Google Cloud コンソールで OAuth クライアントID（ウェブアプリケーション。承認済みのJavaScript生成元に画面のURL）を作成し、スクリプトプロパティ `OAUTH_CLIENT_ID` に設定する。
3. スクリプトプロパティ `APP_URL` に画面のURLを設定する（通知に載せます）。
4. 「デプロイ → 新しいデプロイ → ウェブアプリ」：実行するユーザー＝**自分**、アクセスできるユーザー＝**全員**。表示されたURLを画面の `VITE_API_URL` に使う。

## 3. 画面の公開（Vercel または Cloudflare Pages）

**Vercel**：Root Directory を `apps/zelnora-web` にしてインポートするだけです（`vercel.json` 設定済み）。手順は [vercel.md](vercel.md) のA。

**Cloudflare Pages** の場合：

- ビルドコマンド：`pnpm install && pnpm --filter @zelnora/web build`
- 出力ディレクトリ：`apps/zelnora-web/dist`
- 環境変数：`VITE_API_URL`（Apps Script のURL）、`VITE_GOOGLE_CLIENT_ID`
- `public/_headers`（CSP など）と `public/_redirects`（SPA）が一緒に配置されます。

## 4. 最初の設定

1. オーナーでログインし、「設定 → 設定ウィザード」で商材を作る（AES は「スクール型」テンプレート）。
2. プランごとの登録フォームで「質問を読み込む」→ 質問と項目を対応付け → テスト取り込み → 公開。
   システムアカウントを各フォームの **編集者** に追加してください（質問IDで対応付けるため）。
3. 「設定 → フォームの対応付け → 送信トリガーを設定」でフォームの送信トリガーを入れる。
4. 「設定 → 利用者とロール」でスタッフを登録する。スタッフにはスプレッドシートを共有しません。
5. 売上の計上ルールと基準日（Q-03）は、経理・税理士の確認後に商材・プランごとに設定する。

## 5. 既存の4シートの扱い（2.4）

「設定 → データソース登録簿」に既存のシートを登録すると、そのシートを正本として読み書きします。

- 列の対応は「項目 → 見出し」で登録します（`id` の列は必須。ない場合はシートに ID 列を追加してください）。
- 対応のない項目は、DBスプレッドシートの `_ext_<種類>` タブに保存します。
- 見出しが変わると書き込みを止め、オーナーに通知します。登録を直すと再開します。
- 「月次売上」と「データソース一覧」は、用途「月次売上（書き出し先）」「データソース一覧（書き出し先）」に登録した管理シートのタブへ書き出します（未登録ならDBスプレッドシートに書き出し）。

## 6. 通知

「設定 → 基本設定」で Slack / Google Chat の Webhook と、メール通知の有無を設定します。
無料のGoogleアカウントはメール送信の1日の上限が小さいため、Webhook の利用を推奨します。

## 7. 電子契約との連携（12章）

「契約手続き」の段階に移すと、電子契約システム（`apps/sign`）で契約書を作成して顧客に送り、署名が完了すると商談を成約にします。

1. スクリプトプロパティ `ESIGN_API_KEY` と `ESIGN_WEBHOOK_SECRET` を設定する（値は電子契約側の `INTEGRATION_API_KEY`・`INTEGRATION_WEBHOOK_SECRET` と同じ。手順は [電子契約のセットアップ 4.2](sign-setup.md)）。
2. 電子契約側の `INTEGRATION_WEBHOOK_URL` に、この Apps Script のウェブアプリのURLを設定する。
3. 「設定 → 電子契約」で URL を入力し、「接続を確認してテンプレートを読み込む」→ プランごとにテンプレートを選び、契約書の項目に入れる値（顧客の氏名・金額・プラン名・今日の日付など）を対応付けて保存。

- 商談の画面に「電子契約」の欄が出ます（作成・署名URLのコピー・状態の更新）。営業ボードのカードにも状態が出ます。
- 署名の完了は通知ですぐに反映し、届かなかった場合も15分ごとの処理（`retryImportsJob`）で確認します。
- 成約に必要な項目が足りないなどで自動で成約にできない場合は、担当に通知します。
- デモモードでは、ブラウザ内の仮の電子契約システムにつながり、「（デモ）顧客が署名したことにする」で流れを試せます。
