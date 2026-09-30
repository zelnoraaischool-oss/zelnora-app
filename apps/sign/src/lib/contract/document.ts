// 契約本文（TipTap/ProseMirror互換のJSON）の操作。サーバーとブラウザの両方で使う。
import { VARIABLE_PLACEHOLDER } from "./variables";

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/** 特商法の最終確認画面に表示する項目 */
export const CONFIRM_ITEMS = {
  service: "サービスの内容・分量",
  price: "対価（支払総額）",
  payment: "支払の時期と方法",
  delivery: "サービスの提供時期",
  period: "申込期間",
  cancellation: "解約・返金に関する事項",
} as const;
export type ConfirmItemKey = keyof typeof CONFIRM_ITEMS;
export type ConfirmScreenItems = Partial<Record<ConfirmItemKey, string>>;

export interface KeyClause {
  id: string;
  title: string;
  description: string;
}

export function parseConfirmItems(input: unknown): ConfirmScreenItems {
  const out: ConfirmScreenItems = {};
  if (!input || typeof input !== "object") return out;
  for (const k of Object.keys(CONFIRM_ITEMS) as ConfirmItemKey[]) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

export function parseKeyClauses(input: unknown): KeyClause[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => ({
      id: typeof x.id === "string" && x.id ? x.id : `k${i + 1}`,
      title: typeof x.title === "string" ? x.title.trim() : "",
      description: typeof x.description === "string" ? x.description.trim() : "",
    }))
    .filter((x) => x.title !== "");
}

const ALLOWED_NODES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "hardBreak",
  "horizontalRule",
  "blockquote",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "variable",
]);
const ALLOWED_MARKS = new Set(["bold", "italic", "underline", "strike"]);

/** 外部から受け取った本文JSONを、許可したノードだけに絞って安全にする */
export function sanitizeDoc(input: unknown): DocNode {
  function clean(n: unknown, depth: number): DocNode | null {
    if (depth > 30 || !n || typeof n !== "object") return null;
    const o = n as Record<string, unknown>;
    if (typeof o.type !== "string" || !ALLOWED_NODES.has(o.type)) return null;
    const node: DocNode = { type: o.type };
    if (o.type === "text") {
      if (typeof o.text !== "string" || o.text === "") return null;
      node.text = o.text.slice(0, 20000);
      if (Array.isArray(o.marks)) {
        const marks = o.marks
          .filter((m): m is { type: string } => !!m && typeof m === "object" && ALLOWED_MARKS.has((m as DocMark).type))
          .map((m) => ({ type: m.type }));
        if (marks.length) node.marks = marks;
      }
      return node;
    }
    const a = (o.attrs ?? {}) as Record<string, unknown>;
    if (o.type === "heading") {
      node.attrs = { level: Math.min(3, Math.max(1, Number(a.level) || 2)), numbered: a.numbered === true };
    } else if (o.type === "variable") {
      if (typeof a.key !== "string" || a.key.trim() === "") return null;
      node.attrs = { key: a.key.trim() };
      return node;
    } else if (o.type === "orderedList") {
      node.attrs = { start: Number(a.start) > 0 ? Number(a.start) : 1 };
    } else if (o.type === "tableCell" || o.type === "tableHeader") {
      node.attrs = {
        colspan: Number(a.colspan) > 0 ? Number(a.colspan) : 1,
        rowspan: Number(a.rowspan) > 0 ? Number(a.rowspan) : 1,
      };
    }
    if (Array.isArray(o.content)) {
      const content = o.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => c !== null);
      if (content.length) node.content = content;
    }
    return node;
  }
  const root = clean(input, 0);
  if (!root || root.type !== "doc") return structuredClone(EMPTY_DOC);
  return root;
}

export function walk(node: DocNode, fn: (n: DocNode) => void): void {
  fn(node);
  node.content?.forEach((c) => walk(c, fn));
}

/** 本文で使われている変数名（{{…}} と変数ノードの両方） */
export function collectVariableKeys(doc: DocNode): string[] {
  const keys = new Set<string>();
  walk(doc, (n) => {
    if (n.type === "variable" && typeof n.attrs?.key === "string") keys.add(n.attrs.key);
    if (n.type === "text" && n.text) {
      for (const m of n.text.matchAll(VARIABLE_PLACEHOLDER)) if (m[1]) keys.add(m[1].trim());
    }
  });
  return [...keys];
}

export function collectTextVariableKeys(text: string): string[] {
  return [...text.matchAll(VARIABLE_PLACEHOLDER)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

export type Resolver = (key: string) => string | undefined;

/** 文字列中の {{変数}} を置き換える。未解決のものは残す */
export function fillText(text: string, resolve: Resolver): string {
  return text.replace(VARIABLE_PLACEHOLDER, (all, key: string) => {
    const v = resolve(key.trim());
    return v === undefined || v === "" ? all : v;
  });
}

/**
 * 変数を埋め、条番号を振った本文を返す。
 * 差し込んだ値には "var" マーク、未入力の変数には "missing" マークを付ける（表示の色分け用）。
 */
export function resolveDocument(doc: DocNode, resolve: Resolver): DocNode {
  let article = 0;
  function splitText(node: DocNode): DocNode[] {
    const text = node.text ?? "";
    const out: DocNode[] = [];
    let last = 0;
    for (const m of text.matchAll(VARIABLE_PLACEHOLDER)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ ...node, text: text.slice(last, idx) });
      out.push(variableText((m[1] ?? "").trim(), node.marks));
      last = idx + m[0].length;
    }
    if (last < text.length) out.push({ ...node, text: text.slice(last) });
    return out;
  }
  function variableText(key: string, marks: DocMark[] | undefined): DocNode {
    const v = resolve(key);
    if (v === undefined || v === "") {
      return { type: "text", text: `{{${key}}}`, marks: [...(marks ?? []), { type: "missing", attrs: { key } }] };
    }
    return { type: "text", text: v, marks: [...(marks ?? []), { type: "var", attrs: { key } }] };
  }
  function visit(node: DocNode): DocNode[] {
    if (node.type === "text") return node.text ? splitText(node) : [];
    if (node.type === "variable") return [variableText(String(node.attrs?.key ?? ""), node.marks)];
    const copy: DocNode = { ...node };
    if (node.content) copy.content = node.content.flatMap(visit);
    if (node.type === "heading" && node.attrs?.numbered) {
      article += 1;
      copy.attrs = { ...node.attrs, articleNo: article };
      copy.content = [{ type: "text", text: `第${article}条　` }, ...(copy.content ?? [])];
    }
    return [copy];
  }
  return visit(doc)[0] ?? structuredClone(EMPTY_DOC);
}

/** 本文をプレーンテキストにする（メール・ハッシュ計算の補助用） */
export function documentToPlainText(doc: DocNode): string {
  const lines: string[] = [];
  function inline(n: DocNode): string {
    if (n.type === "text") return n.text ?? "";
    if (n.type === "hardBreak") return "\n";
    if (n.type === "variable") return `{{${String(n.attrs?.key ?? "")}}}`;
    return (n.content ?? []).map(inline).join("");
  }
  function block(n: DocNode, prefix = ""): void {
    switch (n.type) {
      case "doc":
      case "blockquote":
        n.content?.forEach((c) => block(c, prefix));
        break;
      case "paragraph":
      case "heading":
        lines.push(prefix + inline(n));
        break;
      case "bulletList":
        n.content?.forEach((li) => li.content?.forEach((c, i) => block(c, i === 0 ? `${prefix}・` : `${prefix}　`)));
        break;
      case "orderedList": {
        const start = Number(n.attrs?.start ?? 1);
        n.content?.forEach((li, idx) =>
          li.content?.forEach((c, i) => block(c, i === 0 ? `${prefix}${start + idx}. ` : `${prefix}   `)),
        );
        break;
      }
      case "table":
        n.content?.forEach((row) => lines.push(prefix + (row.content ?? []).map((cell) => inline(cell)).join(" | ")));
        break;
      case "horizontalRule":
        lines.push("―――");
        break;
      default:
        lines.push(prefix + inline(n));
    }
  }
  block(doc);
  return lines.join("\n");
}

/** キーを並べ替えた決定的なJSON（ハッシュ計算用） */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** 条項ライブラリの本文（doc）を、テンプレートに挿入できるブロック列にする */
export function docBlocks(doc: DocNode): DocNode[] {
  return doc.type === "doc" ? (doc.content ?? []) : [doc];
}
