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
