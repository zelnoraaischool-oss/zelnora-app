import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "owner@example.com");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/admin");
}

test("既存の契約書（PDF）を格納し、締結済みの契約として検索・閲覧できる", async ({ page }) => {
  await login(page);
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText(`existing contract ${Date.now()}`, { x: 20, y: 150, size: 12 });
  const pdf = Buffer.from(await doc.save());

  await page.getByRole("link", { name: "既存の契約書を格納" }).click();
  await page.getByLabel("契約書のPDF").setInputFiles({ name: "業務委託契約書_2025.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("textbox", { name: "契約書の名前" })).toHaveValue("業務委託契約書_2025");
  await page.getByRole("textbox", { name: "相手方（会社名または氏名）" }).fill("株式会社E2E商事");
  await page.locator('input[name="signedDate"]').fill("2025-04-01");
  await page.getByRole("textbox", { name: "金額（円）" }).fill("1200000");
  await page.getByRole("button", { name: "格納する" }).click();
  await expect(page.getByRole("heading", { name: "格納しました" })).toBeVisible();
  await expect(page.getByText(/タイムスタンプも付与しました/)).toBeVisible();

  await page.getByRole("link", { name: "詳細を見る" }).click();
  await expect(page.getByText("なし（既存の契約書を格納）")).toBeVisible();
  await expect(page.getByText("原本（格納したPDF）・タイムスタンプ")).toBeVisible();
  await expect(page.getByText("業務委託契約書_2025.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "原本のPDFをダウンロード" })).toBeVisible();

  // 一覧で「既存の契約書（格納）」に絞り込める
  await page.goto("/admin?templateId=imported&counterparty=E2E");
  await expect(page.getByRole("cell", { name: /業務委託契約書_2025/ }).first()).toBeVisible();
});

test("Wordの契約書（.docx）からテンプレートの本文を作る", async ({ page }) => {
  await login(page);
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[
      p("秘密保持契約書"),
      p("{{相手方名}}と当社は、次のとおり合意する。"),
      p("第1条（目的）"),
      p("本契約は秘密情報の取扱いを定める。"),
      p("第2条（期間）"),
      p("本契約の有効期間は{{有効期間}}とする。"),
    ].join("")}</w:body></w:document>`,
  );
  const docx = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

  await page.goto("/admin/templates");
  await page.getByPlaceholder("テンプレート名（例：業務委託契約書）").fill(`秘密保持契約書 ${Date.now()}`);
  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL(/\/admin\/templates\/[0-9a-f-]{36}/);
  page.once("dialog", (d) => void d.accept());
  await page.getByLabel("Wordファイルを選ぶ").setInputFiles({
    name: "秘密保持契約書.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });
  await expect(page.getByText("読み込みました（条 2 件）")).toBeVisible();
  await expect(page.getByText(/変数を 2 件追加しました：相手方名、有効期間/)).toBeVisible();
  const editor = page.getByLabel("契約書の本文");
  await expect(editor).toContainText("本契約は秘密情報の取扱いを定める。");
  await expect(editor.locator("h2[data-numbered='true']")).toHaveCount(2);
});
