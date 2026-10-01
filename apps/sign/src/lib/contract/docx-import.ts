// Word（.docx）の契約書を、テンプレートの本文（TipTap互換のJSON）に変換する。サーバー専用。
// mammoth で HTML にしてから、許可した要素だけを本文のノードに置き換える。
import mammoth from "mammoth";
import { type DocMark, type DocNode, collectVariableKeys, sanitizeDoc } from "./document";

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const VOID = new Set(["br", "img", "hr", "col", "meta", "link", "input"]);

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** mammoth が出力する単純なHTMLを木にする */
export function parseHtml(html: string): El {
  const root: El = { tag: "root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) {
      top.children.push(decode(m[5]));
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      const idx = stack.map((e) => e.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]!.toLowerCase()] = decode(a[2]!);
    const el: El = { tag, attrs, children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

const MARKS: Record<string, string> = { strong: "bold", b: "bold", em: "italic", i: "italic", u: "underline", s: "strike", strike: "strike", del: "strike" };
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "hr"]);

function inline(nodes: (El | string)[], marks: DocMark[] = []): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (typeof n === "string") {
      const text = n.replace(/[\r\n\t]+/g, " ");
      if (text) out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
      continue;
    }
    if (n.tag === "br") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (n.tag === "img") continue;
    const mark = MARKS[n.tag];
    out.push(...inline(n.children, mark && !marks.some((x) => x.type === mark) ? [...marks, { type: mark }] : marks));
  }
  // 隣り合う同じ書式のテキストをまとめる
  const merged: DocNode[] = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev?.type === "text" && n.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text = (prev.text ?? "") + (n.text ?? "");
    } else merged.push({ ...n });
  }
  return merged;
}

function plainText(nodes: DocNode[]): string {
  return nodes.map((n) => n.text ?? "").join("");
}

/** 先頭の文字を削る（書式を保ったまま） */
function stripPrefix(nodes: DocNode[], length: number): DocNode[] {
  let rest = length;
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (rest > 0 && n.type === "text") {
      const t = n.text ?? "";
      if (t.length <= rest) {
        rest -= t.length;
        continue;
      }
      out.push({ ...n, text: t.slice(rest) });
      rest = 0;
      continue;
    }
    if (rest > 0 && n.type === "hardBreak") continue;
    out.push(n);
  }
  return out;
}

const ARTICLE = /^[\s　]*第[\s　]*[0-9０-９一二三四五六七八九十百千]+[\s　]*条[\s　]*/;

function blocks(nodes: (El | string)[]): DocNode[] {
  const out: DocNode[] = [];
  let pending: (El | string)[] = [];
  const flush = () => {
    const content = inline(pending);
    pending = [];
    if (plainText(content).trim() || content.some((c) => c.type !== "text")) out.push({ type: "paragraph", content });
  };
  for (const n of nodes) {
    if (typeof n === "string" || !BLOCKS.has(n.tag)) {
      if (typeof n !== "string" && ["thead", "tbody", "div", "section", "article"].includes(n.tag)) {
        flush();
        out.push(...blocks(n.children));
      } else pending.push(n);
      continue;
    }
    flush();
    out.push(...block(n));
  }
  flush();
  return out;
}

function block(el: El): DocNode[] {
  switch (el.tag) {
    case "p": {
      const content = inline(el.children);
      const text = plainText(content);
      if (!text.trim() && !content.some((c) => c.type !== "text" && c.type !== "hardBreak")) return [{ type: "paragraph" }];
      // 「第N条（目的）」は条番号を自動で振る見出しにする（番号はシステムが振り直す）
      const m = ARTICLE.exec(text);
      if (m && text.length <= 60) {
        const rest = stripPrefix(content, m[0].length);
        return [{ type: "heading", attrs: { level: 2, numbered: true }, content: rest.length ? rest : undefined }];
      }
      return [{ type: "paragraph", content }];
    }
    case "h1":
      return [{ type: "heading", attrs: { level: 1, numbered: false }, content: inline(el.children) }];
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const content = inline(el.children);
      const text = plainText(content);
      const m = ARTICLE.exec(text);
      if (m) return [{ type: "heading", attrs: { level: 2, numbered: true }, content: stripPrefix(content, m[0].length) }];
      return [{ type: "heading", attrs: { level: el.tag === "h2" ? 2 : 3, numbered: false }, content }];
    }
    case "ul":
    case "ol":
      return [
        {
          type: el.tag === "ul" ? "bulletList" : "orderedList",
          ...(el.tag === "ol" ? { attrs: { start: 1 } } : {}),
          content: el.children
            .filter((c): c is El => typeof c !== "string" && c.tag === "li")
            .map((li) => {
              const content = blocks(li.children);
              return { type: "listItem", content: content.length ? content : [{ type: "paragraph" }] };
            }),
        },
      ];
    case "table": {
      const rows: El[] = [];
      const collect = (e: El) => {
        for (const c of e.children) {
          if (typeof c === "string") continue;
          if (c.tag === "tr") rows.push(c);
          else if (["thead", "tbody", "tfoot"].includes(c.tag)) collect(c);
        }
      };
      collect(el);
      const tableRows = rows
        .map((tr) => ({
          type: "tableRow",
          content: tr.children
            .filter((c): c is El => typeof c !== "string" && (c.tag === "td" || c.tag === "th"))
            .map((cell) => {
              const content = blocks(cell.children);
              return {
                type: cell.tag === "th" ? "tableHeader" : "tableCell",
                attrs: { colspan: Number(cell.attrs.colspan) || 1, rowspan: Number(cell.attrs.rowspan) || 1 },
                content: content.length ? content : [{ type: "paragraph" }],
              };
            }),
        }))
        .filter((r) => r.content.length);
      return tableRows.length ? [{ type: "table", content: tableRows }] : [];
    }
    case "blockquote":
      return [{ type: "blockquote", content: blocks(el.children) }];
    case "hr":
      return [{ type: "horizontalRule" }];
    default:
      return [];
  }
}

/** HTML（mammoth の出力）→ 本文JSON */
export function htmlToDoc(html: string): DocNode {
  const content = blocks(parseHtml(html).children);
  // 連続する空の段落は1つにまとめる
  const compact = content.filter((n, i) => !(n.type === "paragraph" && !n.content && content[i - 1]?.type === "paragraph" && !content[i - 1]?.content));
  while (compact[0]?.type === "paragraph" && !compact[0].content) compact.shift();
  // 先頭が短い「〇〇契約書」などの段落なら表題にする
  const first = compact[0];
  if (first?.type === "paragraph" && first.content) {
    const t = plainText(first.content).trim();
    if (t.length <= 40 && /(契約書|規約|約款|申込書|同意書|覚書|合意書)$/.test(t)) {
      compact[0] = { type: "heading", attrs: { level: 1, numbered: false }, content: [{ type: "text", text: t }] };
    }
  }
  return sanitizeDoc({ type: "doc", content: compact.length ? compact : [{ type: "paragraph" }] });
}

export interface DocxImportResult {
  doc: DocNode;
  /** 本文中の {{変数名}} */
  variableKeys: string[];
  /** 表題（最初の見出し） */
  title: string | null;
  articleCount: number;
  warnings: string[];
}

export const DOCX_MAX_BYTES = 4 * 1024 * 1024;

export async function docxToTemplate(bytes: Uint8Array): Promise<DocxImportResult> {
  if (bytes.length > DOCX_MAX_BYTES) throw new Error("ファイルが大きすぎます（4MBまで）");
  // .docx は ZIP（先頭が PK）
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Word（.docx）のファイルを選んでください（.doc の場合は .docx で保存し直してください）");
  const r = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })), ignoreEmptyParagraphs: false },
  );
  const doc = htmlToDoc(r.value);
  let title: string | null = null;
  let articleCount = 0;
  for (const n of doc.content ?? []) {
    if (n.type === "heading" && n.attrs?.level === 1 && !title) title = plainText(n.content ?? []).trim() || null;
    if (n.type === "heading" && n.attrs?.numbered) articleCount++;
  }
  const warnings: string[] = [];
  if (/<img/.test(r.value)) warnings.push("画像は読み込んでいません（社印などは署名時に不要です）");
  return { doc, variableKeys: collectVariableKeys(doc), title, articleCount, warnings };
}
