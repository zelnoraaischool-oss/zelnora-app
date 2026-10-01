import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToTemplate, htmlToDoc } from "@/lib/contract/docx-import";

function para(text: string, opts: { bold?: boolean; style?: string } = {}) {
  const ppr = opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : "";
  const rpr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function makeDocx(bodyXml: string): Promise<Uint8Array> {
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
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("Wordの契約書の読み込み", () => {
  it("表題・第N条・変数・表を本文のノードにする", async () => {
    const bytes = await makeDocx(
      [
        para("業務委託契約書"),
        para("{{氏名}}（以下「甲」という）と当社は、次のとおり契約を締結する。"),
        para("第１条（目的）", { bold: true }),
        para("本契約は、甲に業務を委託することを目的とする。"),
        para("第2条 報酬"),
        para("報酬は金{{報酬額}}円とする。"),
        `<w:tbl><w:tr><w:tc>${para("支払日")}</w:tc><w:tc>${para("毎月末日")}</w:tc></w:tr></w:tbl>`,
      ].join(""),
    );
    const r = await docxToTemplate(bytes);
    const blocks = r.doc.content!;
    expect(r.title).toBe("業務委託契約書");
    expect(blocks[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    const articles = blocks.filter((b) => b.type === "heading" && b.attrs?.numbered);
    expect(articles).toHaveLength(2);
    expect(r.articleCount).toBe(2);
    // 「第１条」の部分は削り、見出しの残り（条名）だけを持つ（番号はシステムが振る）
    expect(articles[0]!.content?.map((c) => c.text).join("")).toBe("（目的）");
    expect(articles[1]!.content?.map((c) => c.text).join("")).toBe("報酬");
    expect(r.variableKeys).toEqual(expect.arrayContaining(["氏名", "報酬額"]));
    expect(blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("docx以外のファイルは受け付けない", async () => {
    await expect(docxToTemplate(new TextEncoder().encode("%PDF-1.7"))).rejects.toThrow(/docx/);
  });

  it("書式（太字・下線）と箇条書きを保ち、許可していない要素は捨てる", () => {
    const doc = htmlToDoc(
      `<p><strong>重要</strong>：<u>解約</u>は<a href="javascript:alert(1)">こちら</a></p><ol><li>一</li><li>二</li></ol><p><img src="x.png"/></p><script>alert(1)</script>`,
    );
    const p = doc.content![0]!;
    expect(p.content![0]).toMatchObject({ text: "重要", marks: [{ type: "bold" }] });
    expect(p.content!.some((c) => c.marks?.some((m) => m.type === "underline"))).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/javascript|script|img/);
    expect(doc.content!.find((b) => b.type === "orderedList")?.content).toHaveLength(2);
  });
});
