import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, degrees, rgb } from "pdf-lib";
import subsetFont from "subset-font";
import type { DocMark, DocNode } from "../contract/document";
import { formatJst } from "../format";
import { loadFonts } from "./fonts";
import { Layout, type Run } from "./layout";

export interface CertificateEvent {
  at: string; // ISO
  label: string;
  detail?: string;
  ip?: string | null;
}

export interface CertificateData {
  contractId: string;
  templateName: string;
  templateVersion: number;
  templateBodyHash: string;
  organizationName: string;
  signerName: string;
  signerEmail: string;
  verificationMethod: string;
  events: CertificateEvent[];
  contentHash: string;
  contentTimestamp?: { time: string; tsaUrl: string; serial?: string | null } | null;
  verifyUrl?: string;
}

export interface ContractPdfInput {
  title: string;
  /** 変数を埋め、条番号を振った本文（resolveDocument の結果） */
  body: DocNode;
  organizationName: string;
  contractId?: string;
  signer?: {
    name: string;
    email?: string | null;
    signedAt: string;
    signatureImagePng?: Uint8Array | null;
  };
  certificate?: CertificateData;
  /** プレビュー：透かしを入れ、差し込み値を色付きで表示する */
  preview?: boolean;
  /** PDFのメタデータ上の作成日時（確定版では署名日時） */
  createdAt?: Date;
}

const VAR_COLOR = rgb(0.05, 0.35, 0.75);
const MISSING_COLOR = rgb(0.8, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.45);

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");

/**
 * 契約書PDFを生成する。
 * pdf-lib（fontkit）のサブセット化はNoto Sans JPのグリフが欠けるため、
 * 1回目の描画で使用文字を集め、HarfBuzzでサブセット化したフォントを埋め込んで2回目を描画する。
 */
export async function renderContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const full = await loadFonts();
  const used = new Set<string>();
  await renderPass(input, full, false, (t) => {
    for (const ch of t) used.add(ch);
  });
  const text = ASCII + [...used].join("");
  const [regular, bold] = await Promise.all([
    subsetFont(Buffer.from(full.regular), text, { targetFormat: "sfnt", keepFeatures: [] }),
    subsetFont(Buffer.from(full.bold), text, { targetFormat: "sfnt", keepFeatures: [] }),
  ]);
  return renderPass(input, { regular: new Uint8Array(regular), bold: new Uint8Array(bold) }, true, () => {});
}

async function renderPass(
  input: ContractPdfInput,
  fontBytes: { regular: Uint8Array; bold: Uint8Array },
  final: boolean,
  record: (text: string) => void,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = {
    regular: await pdf.embedFont(fontBytes.regular, { subset: false }),
    bold: await pdf.embedFont(fontBytes.bold, { subset: false }),
  };
  const created = input.createdAt ?? new Date();
  pdf.setTitle(input.title);
  pdf.setAuthor(input.organizationName);
  pdf.setProducer("zelnora-sign");
  pdf.setCreator("zelnora-sign");
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);
  pdf.setLanguage("ja-JP");

  const layout = new Layout(
    pdf,
    fonts,
    undefined,
    (page) => {
      if (input.preview) drawWatermark(page, fonts.bold, record);
    },
    record,
  );

  // 表題
  layout.paragraph([{ text: input.title, bold: true }], { size: 17, align: "center", spaceAfter: 18, lineHeight: 1.5 });

  renderBlocks(layout, input.body.content ?? [], { preview: !!input.preview, indent: 0 });

  // 署名欄
  layout.gap(12);
  layout.ensure(150);
  layout.rule();
  layout.paragraph([{ text: "署名欄", bold: true }], { size: 11, spaceAfter: 6 });
  const rows: { cells: { runs: Run[]; header?: boolean }[] }[] = [
    { cells: [{ runs: [{ text: "事業者" }], header: true }, { runs: [{ text: input.organizationName }] }] },
    {
      cells: [
        { runs: [{ text: "署名者（氏名）" }], header: true },
        { runs: [{ text: input.signer?.name ?? (input.preview ? "（署名時に入力）" : "") }] },
      ],
    },
    {
      cells: [
        { runs: [{ text: "署名日時" }], header: true },
        { runs: [{ text: input.signer ? `${formatJst(input.signer.signedAt, { seconds: true })}（日本時間）` : "" }] },
      ],
    },
  ];
  if (input.signer?.email) {
    rows.push({ cells: [{ runs: [{ text: "本人確認済みメールアドレス" }], header: true }, { runs: [{ text: input.signer.email }] }] });
  }
  layout.table(rows, { size: 10, colRatios: [1, 3] });
  if (input.signer?.signatureImagePng) {
    const img = await pdf.embedPng(input.signer.signatureImagePng);
    const maxW = 200;
    const maxH = 70;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    layout.ensure(h + 24);
    layout.paragraph([{ text: "手書きサイン" }], { size: 9, spaceAfter: 2 });
    layout.page.drawImage(img, { x: layout.left + 8, y: layout.y - h, width: w, height: h });
    layout.y -= h + 8;
  }

  if (input.certificate) renderCertificate(layout, input.certificate);

  // フッター（契約IDとページ番号）
  const total = layout.pages.length;
  layout.pages.forEach((page, i) => {
    const text = `${input.contractId ? `契約ID ${input.contractId}　` : ""}${i + 1} / ${total}`;
    const w = fonts.regular.widthOfTextAtSize(text, 8);
    record(text);
    page.drawText(text, { x: (page.getWidth() - w) / 2, y: 32, size: 8, font: fonts.regular, color: MUTED });
  });

  if (!final) return new Uint8Array();
  return pdf.save({ useObjectStreams: true });
}

function drawWatermark(page: PDFPage, font: PDFFont, record: (t: string) => void) {
  const text = "プレビュー（見本）";
  record(text);
  page.drawText(text, {
    x: 120,
    y: 300,
    size: 56,
    font,
    color: rgb(0.85, 0.85, 0.88),
    rotate: degrees(35),
    opacity: 0.5,
  });
}

interface RenderCtx {
  preview: boolean;
  indent: number;
}

function inlineRuns(nodes: DocNode[] | undefined, ctx: RenderCtx, base: Partial<Run> = {}): Run[] {
  const runs: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      runs.push({ text: "\n" });
    } else if (n.type === "text") {
      runs.push(styleRun(n.text ?? "", n.marks, ctx, base));
    } else if (n.type === "variable") {
      runs.push({ text: `{{${String(n.attrs?.key ?? "")}}}`, color: MISSING_COLOR });
    } else if (n.content) {
      runs.push(...inlineRuns(n.content, ctx, base));
    }
  }
  return runs;
}

function styleRun(text: string, marks: DocMark[] | undefined, ctx: RenderCtx, base: Partial<Run>): Run {
  const run: Run = { text, ...base };
  for (const m of marks ?? []) {
    if (m.type === "bold") run.bold = true;
    if (m.type === "underline") run.underline = true;
    if (m.type === "var" && ctx.preview) run.color = VAR_COLOR;
    if (m.type === "missing") run.color = MISSING_COLOR;
  }
  return run;
}

function renderBlocks(layout: Layout, blocks: DocNode[], ctx: RenderCtx): void {
  for (const b of blocks) renderBlock(layout, b, ctx);
}

function renderBlock(layout: Layout, node: DocNode, ctx: RenderCtx, marker?: string): void {
  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const size = level === 1 ? 14 : level === 2 ? 11.5 : 10.5;
      layout.gap(level === 1 ? 8 : 4);
      layout.ensure(size * 4);
      layout.paragraph(inlineRuns(node.content, ctx, { bold: true }), {
        size,
        indent: ctx.indent,
        align: level === 1 ? "center" : "left",
        spaceAfter: 4,
        lineHeight: 1.6,
      });
      break;
    }
    case "paragraph":
      layout.paragraph(inlineRuns(node.content, ctx), { indent: ctx.indent, marker });
      break;
    case "bulletList":
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      (node.content ?? []).forEach((li, idx) => {
        const m = node.type === "bulletList" ? "・" : `${start + idx}.`;
        const children = li.content ?? [];
        children.forEach((child, ci) => {
          if (ci === 0 && child.type === "paragraph") {
            renderBlock(layout, child, ctx, m);
          } else {
            renderBlock(layout, child, { ...ctx, indent: ctx.indent + 16 });
          }
        });
      });
      break;
    }
    case "blockquote": {
      renderBlocks(layout, node.content ?? [], { ...ctx, indent: ctx.indent + 14 });
      break;
    }
    case "horizontalRule":
      layout.rule();
      break;
    case "table": {
      const rows = (node.content ?? []).map((row) => ({
        cells: (row.content ?? []).map((cell) => {
          const runs: Run[] = [];
          (cell.content ?? []).forEach((p, i) => {
            if (i > 0) runs.push({ text: "\n" });
            runs.push(...inlineRuns(p.type === "paragraph" ? p.content : [p], ctx));
          });
          return { runs, header: cell.type === "tableHeader", colspan: Number(cell.attrs?.colspan ?? 1) };
        }),
      }));
      layout.table(rows, { indent: ctx.indent });
      break;
    }
    default:
      if (node.content) renderBlocks(layout, node.content, ctx);
  }
}

function renderCertificate(layout: Layout, c: CertificateData): void {
  layout.addPage();
  layout.paragraph([{ text: "合意締結証明書", bold: true }], { size: 17, align: "center", spaceAfter: 6 });
  layout.paragraph(
    [
      {
        text: "本証明書は、本システムに記録された監査ログに基づき、上記の契約が電子的に締結された経過を証明するものです。",
      },
    ],
    { size: 9, align: "center", spaceAfter: 12 },
  );
  const kv = (k: string, v: string) => ({ cells: [{ runs: [{ text: k }], header: true }, { runs: [{ text: v }] }] });
  layout.paragraph([{ text: "1. 契約の情報", bold: true }], { size: 11, spaceAfter: 4 });
  layout.table(
    [
      kv("契約ID", c.contractId),
      kv("テンプレート", `${c.templateName}（第${c.templateVersion}版）`),
      kv("テンプレート本文のハッシュ値（SHA-256）", c.templateBodyHash),
      kv("契約内容のハッシュ値（SHA-256）", c.contentHash),
    ],
    { size: 9, colRatios: [2, 5] },
  );
  layout.paragraph([{ text: "2. 当事者", bold: true }], { size: 11, spaceAfter: 4 });
  layout.table(
    [
      kv("事業者", c.organizationName),
      kv("署名者 氏名", c.signerName),
      kv("署名者 メールアドレス", c.signerEmail),
      kv("本人確認の方法", c.verificationMethod),
    ],
    { size: 9, colRatios: [2, 5] },
  );
  layout.paragraph([{ text: "3. 締結までの記録（日本時間）", bold: true }], { size: 11, spaceAfter: 4 });
  layout.table(
    [
      {
        cells: [
          { runs: [{ text: "日時" }], header: true },
          { runs: [{ text: "内容" }], header: true },
          { runs: [{ text: "詳細" }], header: true },
          { runs: [{ text: "IPアドレス" }], header: true },
        ],
      },
      ...c.events.map((e) => ({
        cells: [
          { runs: [{ text: formatJst(e.at, { seconds: true }) }] },
          { runs: [{ text: e.label }] },
          { runs: [{ text: e.detail ?? "" }] },
          { runs: [{ text: e.ip ?? "" }] },
        ],
      })),
    ],
    { size: 8.5, colRatios: [2.2, 2.2, 3.4, 1.9] },
  );
  layout.paragraph([{ text: "4. タイムスタンプ", bold: true }], { size: 11, spaceAfter: 4 });
  const ts = c.contentTimestamp;
  layout.table(
    [
      kv(
        "契約内容へのタイムスタンプ（RFC 3161）",
        ts
          ? `${formatJst(ts.time, { seconds: true })}（日本時間）　発行：${ts.tsaUrl}${ts.serial ? `　シリアル：${ts.serial}` : ""}`
          : "取得できませんでした（本PDFのハッシュ値へのタイムスタンプは別途付与されます）",
      ),
      kv(
        "本PDFへのタイムスタンプ",
        "本PDF全体のSHA-256ハッシュ値に対し、外部のタイムスタンプ局によるRFC 3161タイムスタンプを取得し、システムに保存しています。",
      ),
    ],
    { size: 9, colRatios: [2, 5] },
  );
  if (c.verifyUrl) {
    layout.paragraph(
      [{ text: `本PDFが改ざんされていないことは、次のページで確認できます：${c.verifyUrl}` }],
      { size: 9, spaceAfter: 4 },
    );
  }
}
