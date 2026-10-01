# 受け入れ基準と自動テストの対応

## 電子契約システム（要件定義書 8章：フェーズ1）

| # | 受け入れ基準 | 確認している自動テスト |
|---|---|---|
| 1 | テンプレートの選択から署名URLのコピーまでを **30秒以内・3画面以内** | `apps/sign/tests/e2e/sign-flow.spec.ts`（1画面で作成→クリップボードにURL、30秒以内をアサート） |
| 2 | 署名者はスマホだけで、URLを開いてから署名完了まで進める | `tests/e2e/sign-flow.spec.ts`（iPhone 13 の画面サイズで本人確認→全文表示→入力→同意→署名→最終確認→完了） |
| 3 | 確定版PDFを1バイトでも書き換えると検証ページで「一致しない」 | `tests/db/signing-flow.test.ts`（DB関数での照合）、`tests/e2e/sign-flow.spec.ts`（検証ページにPDFを渡して照合） |
| 4 | 署名済みの契約・確定版PDF・監査ログは、管理者の権限でもAPIから更新・削除できない | `tests/db/immutability.test.ts`（authenticated・service_role・DB所有者のいずれでも拒否、ストレージのオブジェクトも拒否） |
| 5 | 監査ログを1件書き換えると整合性チェックで検知 | `tests/db/audit-chain.test.ts`（内容の書き換え、ハッシュごとの偽造、途中の削除） |
| 6 | 公開済みのテンプレートのバージョンは編集できない。編集すると新しいバージョン | `tests/db/immutability.test.ts`（公開版の更新・削除の拒否、下書きからの契約作成の拒否） |
| 7 | 期限切れ・無効化したURLでは本文を一切表示しない | `tests/db/signing-flow.test.ts`（トークンなし・不正・無効化・期限切れ・取消・他人のセッション）、`tests/db/rls.test.ts`（anon は全テーブル参照不可）、`tests/e2e/sign-flow.spec.ts` |
| 8 | 確定版PDFに、合意締結証明書とタイムスタンプの情報が含まれる | `tests/unit/pdf.test.ts`（フォント埋め込み・証明書ページ）、`tests/db/signing-flow.test.ts`（契約内容とPDFの2種類のタイムスタンプ） |
| 9 | 日付・金額・取引先を組み合わせて検索できる | `tests/db/signing-flow.test.ts`（範囲と組み合わせの検索） |

そのほか：OTPのロック・有効期限・再送制限、TSA障害時の再試行キュー、自動リマインド、匿名化、日次ハッシュ、RFC 3161 の応答の検証（`tests/unit/tsa.test.ts`）。

### 追加の機能（DECISIONS 1-27〜1-29）

| 内容 | 確認している自動テスト |
|---|---|
| 既存の契約書（PDF）を格納し、締結済みとして検索・照合できる。格納後は変更・削除できない（DB所有者でも）。二重格納・PDF以外は拒否 | `tests/db/integration.test.ts`、`tests/e2e/import.spec.ts` |
| 連携API：APIキー、externalRef での二重作成の防止、署名完了の通知（HMAC署名・署名URLを含めない）、通知失敗時の再送、anon は通知キューを読めない | `tests/db/integration.test.ts` |
| Wordの契約書（.docx）から本文（表題・第N条・変数・表）を作る。許可していない要素は捨てる | `tests/unit/docx-import.test.ts`、`tests/e2e/import.spec.ts` |

## Zelnora app（Must 要件の主なもの）

| 要件 | 内容 | 確認している自動テスト |
|---|---|---|
| 2.6 / 21章 | 2つ目の商材をコード変更なしで追加・運用できる | `packages/zelnora-core/tests/scenario.test.ts`（コンサル型：月額計上・解約で停止）、`apps/zelnora-web/tests/demo.spec.ts`（ウィザードで単発販売型を追加）、CIの `scripts/check-generic.mjs` |
| 5章 | 営業→登録→提供→売上の自動の受け渡し | `scenario.test.ts`（段階の必須項目、成約で契約・売上予定・フォームURL、フォーム取り込みで登録完了・提供・進捗項目・通知） |
| 5.4 | 例外（契約前の登録・商談なし・二重送信・統合待ち・失敗の記録と再試行） | `scenario.test.ts` |
| ZN-ROLE-01/02/03/04/05 | 担当商材・行の絞り込み・連絡先を伏せる・一括付け替え・ログイン制限 | `scenario.test.ts`、`apps/zelnora-gas/tests/bundle.test.ts`（IDトークンの検証） |
| ZN-CUS-07 | 重複の検出と統合（統合前の状態を記録） | `scenario.test.ts`、`tests/pure.test.ts` |
| ZN-SALES-04/05/08 | 移動の条件・次のアクション・リード登録（手入力・CSV・問い合わせフォーム） | `scenario.test.ts`、`demo.spec.ts` |
| 8.1 / ZN-DLV-* | 進捗テンプレート・受講の記録・休止・修了/解約 | `pure.test.ts`、`scenario.test.ts`、`demo.spec.ts` |
| 9.1 / ZN-REV-* | 計上ルール・税と端数・価格改定・返金・月次締め・集計・書き出し | `pure.test.ts`、`scenario.test.ts`、`bundle.test.ts`（月次売上タブの書き出し） |
| 12章（2-17） | 電子契約との連携：契約の段階で契約書を作成・送付、署名完了（通知・定期確認）で成約、取消・期限切れの通知、失敗時も段階の移動は止めない、通知のHMAC検証・古い通知の拒否 | `packages/zelnora-core/tests/esign.test.ts`、`apps/zelnora-gas/tests/bundle.test.ts`、`apps/zelnora-web/tests/demo.spec.ts` |
| 2.4 / ZN-SET-10/11/12 | データソース登録簿・見出しの変更検知・設定の版管理 | `apps/zelnora-gas/tests/sheets-store.test.ts`、`scenario.test.ts` |
