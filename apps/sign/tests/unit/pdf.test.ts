import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { resolveDocument, type DocNode } from "@/lib/contract/document";
import { renderContractPdf } from "@/lib/pdf/render";

const body: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, numbered: true }, content: [{ type: "text", text: "（目的）" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "受講者" },
        { type: "variable", attrs: { key: "受講者氏名" } },
        { type: "text", text: "（以下「甲」という。）は、受講料{{受講料}}を支払う。".repeat(8) },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "一つ目の項目" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "二つ目の項目", marks: [{ type: "bold" }] }] }] },
      ],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }] },
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "内容" }] }] },
        ] },
        { type: "tableRow", content: [
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "受講料" }] }] },
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "{{受講料}}（税込）" }] }] },
        ] },
      ],
    },
    { type: "heading", attrs: { level: 2, numbered: true }, content: [{ type: "text", text: "（反社会的勢力の排除）" }] },
    ...Array.from({ length: 40 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `第${i + 1}項 長い本文で改ページを発生させます。` }] })),
  ],
};

describe("確定版PDFの生成", () => {
  it("日本語フォントを埋め込み、合意締結証明書を含むPDFを10秒以内に生成する", async () => {
    const values: Record<string, string> = { 受講者氏名: "山田 太郎", 受講料: "30,000円" };
    const resolved = resolveDocument(body, (k) => values[k]);
    const started = Date.now();
    const bytes = await renderContractPdf({
      title: "AIエンジニア育成マンツーマン講座 受講契約書",
      body: resolved,
      organizationName: "AIエンジニアスクール",
      contractId: "00000000-0000-0000-0000-000000000000",
      signer: { name: "山田 太郎", email: "taro@example.com", signedAt: "2026-09-30T06:00:00.000Z" },
      certificate: {
        contractId: "00000000-0000-0000-0000-000000000000",
        templateName: "受講契約書",
        templateVersion: 1,
        templateBodyHash: "a".repeat(64),
        organizationName: "AIエンジニアスクール",
        signerName: "山田 太郎",
        signerEmail: "taro@example.com",
        verificationMethod: "メールのワンタイムパスワード",
        events: [
          { at: "2026-09-30T05:00:00.000Z", label: "送付", detail: "メール", ip: "203.0.113.1" },
          { at: "2026-09-30T06:00:00.000Z", label: "署名", detail: "山田 太郎", ip: "203.0.113.1" },
        ],
        contentHash: "b".repeat(64),
        contentTimestamp: { time: "2026-09-30T06:00:01.000Z", tsaUrl: "https://tsa.example", serial: "123" },
        verifyUrl: "https://sign.example.jp/verify",
      },
      createdAt: new Date("2026-09-30T06:00:00.000Z"),
    });
    const elapsed = Date.now() - started;
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, bytes);
    expect(elapsed).toBeLessThan(10_000);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(loaded.getTitle()).toBe("AIエンジニア育成マンツーマン講座 受講契約書");

    // すべてのフォントが埋め込まれている（FontFile2 を持つ）
    let fontCount = 0;
    for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("FontDescriptor")) {
        fontCount += 1;
        expect(obj.get(PDFName.of("FontFile2")) ?? obj.get(PDFName.of("FontFile3"))).toBeDefined();
      }
    }
    expect(fontCount).toBeGreaterThanOrEqual(2);
    // 埋め込みはサブセット化されている（全体で数MBにならない）
    expect(bytes.length).toBeLessThan(1_500_000);
  });
});
