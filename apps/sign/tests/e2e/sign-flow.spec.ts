import { readFileSync } from "node:fs";
import { expect, test, devices } from "@playwright/test";

function lastOtp(): string {
  const lines = readFileSync(".data-e2e/outbox.jsonl", "utf8").trim().split("\n");
  const mail = lines.map((l) => JSON.parse(l) as { subject: string; text: string }).filter((m) => m.subject.includes("確認コード")).at(-1)!;
  return /確認コード：(\d{6})/.exec(mail.text)![1]!;
}

test("管理者が作成したURLから、署名者がスマホで署名を完了し、検証ページで照合できる", async ({ browser }) => {
  // 管理者：テンプレート選択からURLコピーまで（1画面）
  const admin = await browser.newContext();
  await admin.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await admin.newPage();
  await page.goto("/login");
  await page.fill('input[name="email"]', "owner@example.com");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin");
  const started = Date.now();
  await page.goto("/admin/contracts/new");
  await page.getByLabel("署名者の氏名").fill("検証 太郎");
  await page.getByRole("textbox", { name: "メールアドレス" }).fill("e2e@example.com");
  await page.locator("#var-受講開始日").fill("2026-10-01");
  await page.locator("#var-支払期限").fill("2026-10-10");
  await page.click("text=作成と同時にURLをコピー");
  await expect(page.getByText("契約を作成しました")).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/s#[A-Za-z0-9_-]{43}$/);
  expect(Date.now() - started).toBeLessThan(30_000);

  // 署名者（iPhone）
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const sp = await phone.newPage();
  await sp.goto(url);
  await sp.click("text=確認コードを送る");
  await expect(sp.getByLabel("確認コード（6桁）")).toBeVisible();
  await sp.getByLabel("確認コード（6桁）").fill(lastOtp());
  await sp.click("button:has-text('確認する')");
  await expect(sp.getByText("契約書の内容")).toBeVisible();
  await expect(sp.locator("button:has-text('最後までスクロールしてください')")).toBeDisabled();
  await sp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sp.click("button:has-text('内容を確認しました。次へ')");
  await sp.locator("#var-受講者住所").fill("東京都千代田区丸の内1-1-1");
  await sp.locator("#var-受講者電話番号").fill("090-1234-5678");
  await sp.click("button:has-text('次へ')");
  await expect(sp.getByText("同意事項の確認")).toBeVisible();
  for (const c of await sp.locator("input[type=checkbox]").all()) await c.check();
  await sp.click("button:has-text('次へ')");
  await sp.getByLabel("氏名を入力してください").fill("検証太郎");
  await sp.click("button:has-text('最終確認へ')");
  await expect(sp.getByText("対価（支払総額）")).toBeVisible();
  await sp.click("button:has-text('この内容で契約する')");
  await expect(sp.getByText("契約の締結が完了しました")).toBeVisible({ timeout: 30_000 });
  const sha = (await sp.getByText(/PDFのハッシュ値/).textContent())!.match(/[0-9a-f]{64}/)![0];

  // 管理画面から確定版PDFを取得し、検証ページでファイルを照合する
  await page.goto("/admin");
  await page.click("text=（検証 太郎 様）");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=確定版PDFをダウンロード")]);
  const bytes = readFileSync((await dl.path())!);
  const verify = await browser.newPage();
  await verify.goto("/verify");
  await verify.setInputFiles("input[type=file]", { name: "contract.pdf", mimeType: "application/pdf", buffer: bytes });
  await expect(verify.getByText("このシステムで締結された契約書と一致します。")).toBeVisible();
  await expect(verify.getByPlaceholder("64桁の16進数")).toHaveValue(sha);

  // 1バイト書き換えると一致しない
  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 20] = tampered[tampered.length - 20]! ^ 1;
  await verify.setInputFiles("input[type=file]", { name: "tampered.pdf", mimeType: "application/pdf", buffer: tampered });
  await expect(verify.getByText("一致する契約書はありません。")).toBeVisible();
});

test("トークンなし・不正なURLでは契約書を表示しない", async ({ page }) => {
  await page.goto("/s");
  await expect(page.getByText("URLが正しくありません")).toBeVisible();
  await page.goto(`/s#${"A".repeat(43)}`);
  await expect(page.getByText("このURLは無効です")).toBeVisible();
  await expect(page.locator(".contract-body")).toHaveCount(0);
});
