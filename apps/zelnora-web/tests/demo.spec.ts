import { expect, type Page, test } from "@playwright/test";

async function loginAs(page: Page, name: string) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("zelnora.demoUser"));
  await page.goto("/");
  await page.getByText(name).click();
  await expect(page.getByText("今日やること")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("営業担当：リードを登録し、必須項目を入力して段階を進める", async ({ page }) => {
  await loginAs(page, "佐藤（営業）");
  await page.getByRole("link", { name: "営業" }).click();
  await page.getByRole("button", { name: /を登録$/ }).click();
  await page.getByLabel("氏名").fill("テスト 太郎");
  await page.getByLabel("メール").fill("e2e-lead@example.com");
  await page.getByRole("button", { name: "登録", exact: true }).click();
  const card = page.locator("article", { hasText: "テスト 太郎" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("初回連絡");

  // カードのメニューから段階を変更 → 必須項目（連絡手段）の入力を求められる
  await card.getByRole("button", { name: "メニュー" }).click();
  await card.getByRole("button", { name: "アポ" }).click();
  await expect(page.getByRole("dialog", { name: "段階を変更" })).toBeVisible();
  await page.getByRole("button", { name: "アポ に進める" }).click();
  await expect(page.getByRole("alert")).toContainText("連絡手段");
  await page.getByLabel("連絡手段").selectOption("LINE");
  await page.getByRole("button", { name: "アポ に進める" }).click();
  await expect(page.locator("section[aria-label='アポ'] article", { hasText: "テスト 太郎" })).toBeVisible();

  // 他の営業担当の商談は見えない
  await page.getByRole("link", { name: "顧客" }).click();
  await expect(page.getByText("テスト 太郎")).toBeVisible();
  await expect(page.getByText("石井 翔")).toHaveCount(0);
});

test("提供担当：進捗の表から受講を記録すると完了になる", async ({ page }) => {
  await loginAs(page, "高橋（提供担当）");
  await page.getByRole("navigation").getByRole("link").nth(3).click();
  const row = page.locator("tbody tr").first();
  await expect(row).toBeVisible();
  const planned = row.locator("button[title*='予定'], button[title*='今週'], button[title*='遅れ']").first();
  await planned.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const record = dialog.getByRole("button", { name: /記録して完了|完了にする/ });
  await record.click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator("button[title*='完了']").first()).toBeVisible();
});

test("経理：月を締めると、その月の売上は編集できない", async ({ page }) => {
  await loginAs(page, "伊藤（経理）");
  await page.goto("/revenue");
  const month = await page.getByLabel("計上月").inputValue();
  await page.getByRole("tab", { name: "月次締め" }).click();
  page.once("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: month }).getByRole("button", { name: "締める" }).click();
  await expect(page.getByText(`${month} を締めました`)).toBeVisible();
  await page.getByRole("tab", { name: "売上台帳" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "編集" })).toHaveCount(0);
  // 経理は締めの解除はできない（オーナーのみ）
  await page.getByRole("tab", { name: "月次締め" }).click();
  await expect(page.getByRole("button", { name: "解除" })).toHaveCount(0);
});

test("オーナー：設定ウィザードで2つ目の商材をコード変更なしで追加できる", async ({ page }) => {
  await loginAs(page, "オーナー（デモ）");
  await page.goto("/wizard");
  await page.getByRole("button", { name: /単発販売型/ }).click();
  await page.getByLabel("商材名").fill("動画制作");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "＋ プランを追加" }).click();
  await page.getByLabel("プラン名").fill("ショート動画");
  await page.getByLabel("金額（税込）").fill("55000");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "営業の段階" })).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: /提供の進め方/ })).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "保存して次へ" }).click();
  await expect(page.getByText("ショート動画 の登録フォーム")).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "公開する" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText("動画制作")).toBeVisible();

  // 営業の画面で、新しい商材の段階がそのまま使える
  await page.goto("/sales");
  await page.getByLabel("商材").selectOption({ label: "動画制作" });
  for (const stage of ["リード", "見積", "契約手続き", "受注"]) await expect(page.locator(`section[aria-label='${stage}']`)).toBeVisible();
});

test("マネージャー：CSVでリードを取り込み、既存の人はとばす", async ({ page }) => {
  await loginAs(page, "渡辺（マネージャー）");
  await page.goto("/sales");
  await page.getByRole("button", { name: "CSVで取り込む" }).click();
  const csv = "お名前,メールアドレス,流入経路\n新規 花子,hanako@example.com,展示会\n青木 優,aoki@example.com,\n";
  await page.locator("input[type=file]").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "確認する" }).click();
  await expect(page.getByText("既存：青木 優")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取り込む", exact: true }).click();
  await expect(page.getByText("1件を取り込みました（とばした行 1件）")).toBeVisible();
  await page.getByRole("dialog").getByText("閉じる", { exact: true }).click();
  await expect(page.locator("section[aria-label='リード'] article", { hasText: "新規 花子" })).toBeVisible();
});

test("電子契約：契約の段階に移すと契約書を作成して送り、署名が完了すると締結になる", async ({ page }) => {
  await loginAs(page, "佐藤（営業）");
  await page.getByRole("link", { name: "営業" }).click();
  const card = page.locator("article", { hasText: "上田 美咲" });
  await card.getByRole("button", { name: "メニュー" }).click();
  await card.getByRole("button", { name: "クラウド契約" }).click();
  const move = page.getByRole("dialog", { name: "段階を変更" });
  await move.getByLabel("プラン").selectOption({ index: 1 });
  await move.getByLabel("支払い方法").selectOption("銀行振込");
  await move.getByRole("button", { name: "クラウド契約 に進める" }).click();

  // 契約書を作成し、署名URLを表示する
  const result = page.getByRole("dialog", { name: "電子契約" });
  await expect(result).toContainText("契約書を作成しました");
  await expect(result).toContainText("https://sign.demo.example/s#");
  await result.getByText("閉じる", { exact: true }).click();
  const moved = page.locator("section[aria-label='クラウド契約'] article", { hasText: "上田 美咲" });
  await expect(moved).toContainText("電子契約：署名待ち");

  // 顧客の署名（デモ）→ 締結へ自動で移る
  await moved.click();
  const panel = page.getByRole("region", { name: "電子契約" });
  await expect(panel.getByRole("button", { name: "署名URLをコピー" })).toBeVisible();
  await panel.getByRole("button", { name: "（デモ）顧客が署名したことにする" }).click();
  await expect(panel).toContainText("成約になりました");
  await expect(panel).toContainText("電子契約：署名完了");
  await page.keyboard.press("Escape");
  await expect(page.locator("section[aria-label='締結'] article", { hasText: "上田 美咲" })).toContainText("電子契約：署名完了");
});

test("電子契約：オーナーはプランごとの契約書と差し込む値を設定できる", async ({ page }) => {
  await loginAs(page, "オーナー（デモ）");
  await page.goto("/settings");
  await page.getByRole("tab", { name: "電子契約" }).click();
  await expect(page.getByLabel("電子契約システムのURL")).toHaveValue("https://sign.demo.example");
  await page.getByRole("button", { name: "接続を確認してテンプレートを読み込む" }).click();
  await expect(page.getByText("公開済みのテンプレートが 1 件あります")).toBeVisible();
  const select = page.getByLabel(/月額支援 の契約書/);
  await select.selectOption({ label: "サービス利用契約書（デモ）" });
  await expect(page.getByLabel("月額支援・氏名")).toHaveValue("customer.name");
  await expect(page.getByLabel("月額支援・料金")).toHaveValue("deal.amount");
  await page.getByLabel("月額支援・プラン名").selectOption("text:");
  await page.getByLabel("プラン名の固定の文字").last().fill("法人向け月額支援");
  await page.getByRole("button", { name: "保存" }).last().click();
  await expect(page.getByText("保存しました")).toBeVisible();
});
