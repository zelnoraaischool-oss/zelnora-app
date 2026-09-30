// pdf-lib 上の簡易レイアウトエンジン（日本語の折り返し・禁則・表・改ページ）
import { type PDFDocument, type PDFFont, type PDFPage, type RGB, rgb } from "pdf-lib";

export const A4 = { width: 595.28, height: 841.89 };

export interface Run {
  text: string;
  bold?: boolean;
  color?: RGB;
  underline?: boolean;
}

interface Piece extends Run {
  width: number;
}
export interface Line {
  pieces: Piece[];
  width: number;
}

const BLACK = rgb(0.1, 0.1, 0.12);
// 行頭に置かない文字（ぶら下げを許す）
const NO_LINE_START = new Set([..."、。，．,.)）」』】〕〉》！？!?ー・：；:;ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞ〟’”%％"]);
// 行末に置かない文字
const NO_LINE_END = new Set([..."（(「『【〔〈《“‘"]);

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export class Layout {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly margin = { top: 60, bottom: 64, left: 56, right: 56 },
    private readonly onNewPage?: (page: PDFPage) => void,
    /** 描画した文字を記録する（フォントのサブセット作成用） */
    readonly record: (text: string) => void = () => {},
  ) {
    this.left = margin.left;
    this.right = A4.width - margin.right;
    this.top = A4.height - margin.top;
    this.bottom = margin.bottom;
    this.addPage();
  }

  get contentWidth(): number {
    return this.right - this.left;
  }

  addPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = this.top;
    this.onNewPage?.(this.page);
  }

  ensure(height: number): void {
    if (this.y - height < this.bottom) this.addPage();
  }

  font(bold?: boolean): PDFFont {
    return bold ? this.fonts.bold : this.fonts.regular;
  }

  measure(text: string, size: number, bold?: boolean): number {
    return this.font(bold).widthOfTextAtSize(text, size);
  }

  /** ランの並びを指定幅で折り返す */
  wrap(runs: Run[], maxWidth: number, size: number): Line[] {
    const lines: Line[] = [];
    let cur: Piece[] = [];
    let curW = 0;
    const flush = () => {
      // 行末の空白を落とす
      while (cur.length && /^\s+$/.test(cur[cur.length - 1]!.text)) {
        curW -= cur.pop()!.width;
      }
      lines.push({ pieces: mergePieces(cur), width: curW });
      cur = [];
      curW = 0;
    };
    for (const run of runs) {
      for (const token of tokenize(run.text)) {
        if (token === "\n") {
          flush();
          continue;
        }
        let w = this.measure(token, size, run.bold);
        if (cur.length === 0 && /^\s+$/.test(token)) continue;
        if (curW + w > maxWidth && cur.length > 0) {
          const first = [...token][0] ?? "";
          if (NO_LINE_START.has(first) && [...token].length === 1 && curW + w <= maxWidth + size) {
            // ぶら下げ
          } else {
            // 行末禁則: 直前が開き括弧なら次の行へ送る
            const carry: Piece[] = [];
            while (cur.length > 1 && NO_LINE_END.has(cur[cur.length - 1]!.text)) {
              const p = cur.pop()!;
              curW -= p.width;
              carry.unshift(p);
            }
            flush();
            for (const p of carry) {
              cur.push(p);
              curW += p.width;
            }
            if (/^\s+$/.test(token)) continue;
          }
        }
        if (w > maxWidth) {
          // 長すぎる語は文字単位で分割
          for (const ch of token) {
            const cw = this.measure(ch, size, run.bold);
            if (curW + cw > maxWidth && cur.length > 0) flush();
            cur.push({ ...run, text: ch, width: cw });
            curW += cw;
          }
          continue;
        }
        cur.push({ ...run, text: token, width: w });
        curW += w;
        w = 0;
      }
    }
    if (cur.length || lines.length === 0) flush();
    return lines;
  }

  drawLine(line: Line, x: number, y: number, size: number, align: "left" | "center" | "right" = "left", width = this.contentWidth) {
    let cx = x;
    if (align === "center") cx = x + (width - line.width) / 2;
    if (align === "right") cx = x + width - line.width;
    for (const p of line.pieces) {
      if (p.text.length > 0) {
        this.record(p.text);
        this.page.drawText(p.text, { x: cx, y, size, font: this.font(p.bold), color: p.color ?? BLACK });
      }
      if (p.underline) {
        this.page.drawLine({ start: { x: cx, y: y - 1.5 }, end: { x: cx + p.width, y: y - 1.5 }, thickness: 0.6, color: p.color ?? BLACK });
      }
      cx += p.width;
    }
  }

  /** 段落を描く（改ページ込み） */
  paragraph(
    runs: Run[],
    opts: { size?: number; lineHeight?: number; indent?: number; align?: "left" | "center" | "right"; spaceAfter?: number; marker?: string } = {},
  ): void {
    const size = opts.size ?? 10.5;
    const lh = size * (opts.lineHeight ?? 1.75);
    const indent = opts.indent ?? 0;
    const markerW = opts.marker ? Math.max(this.measure(opts.marker, size), size * 1.2) + 2 : 0;
    const x = this.left + indent + markerW;
    const width = this.right - x;
    const lines = this.wrap(runs, width, size);
    lines.forEach((line, i) => {
      this.ensure(lh);
      const baseline = this.y - size;
      if (i === 0 && opts.marker) {
        this.record(opts.marker);
        this.page.drawText(opts.marker, { x: this.left + indent, y: baseline, size, font: this.fonts.regular, color: BLACK });
      }
      this.drawLine(line, x, baseline, size, opts.align, width);
      this.y -= lh;
    });
    this.y -= opts.spaceAfter ?? size * 0.5;
  }

  gap(h: number): void {
    this.y -= h;
    if (this.y < this.bottom) this.addPage();
  }

  rule(): void {
    this.ensure(12);
    this.y -= 6;
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.right, y: this.y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.65) });
    this.y -= 6;
  }

  /** 表を描く。cells[r][c] はランの配列。colWidths は比率 */
  table(
    rows: { cells: { runs: Run[]; header?: boolean; colspan?: number }[] }[],
    opts: { size?: number; colRatios?: number[]; indent?: number } = {},
  ): void {
    const size = opts.size ?? 9.5;
    const lh = size * 1.55;
    const pad = 4;
    const x0 = this.left + (opts.indent ?? 0);
    const totalW = this.right - x0;
    const ncols = Math.max(1, ...rows.map((r) => r.cells.reduce((s, c) => s + (c.colspan ?? 1), 0)));
    const ratios = opts.colRatios && opts.colRatios.length === ncols ? opts.colRatios : Array(ncols).fill(1);
    const sum = ratios.reduce((a, b) => a + b, 0);
    const colW = ratios.map((r) => (totalW * r) / sum);
    for (const row of rows) {
      let col = 0;
      const laid = row.cells.map((cell) => {
        const span = cell.colspan ?? 1;
        const w = colW.slice(col, col + span).reduce((a, b) => a + b, 0);
        const x = x0 + colW.slice(0, col).reduce((a, b) => a + b, 0);
        col += span;
        const runs = cell.header ? cell.runs.map((r) => ({ ...r, bold: true })) : cell.runs;
        return { x, w, header: cell.header, lines: this.wrap(runs, w - pad * 2, size) };
      });
      const rowH = Math.max(...laid.map((l) => l.lines.length * lh)) + pad * 2;
      this.ensure(Math.min(rowH, this.top - this.bottom));
      const topY = this.y;
      for (const cell of laid) {
        this.page.drawRectangle({
          x: cell.x,
          y: topY - rowH,
          width: cell.w,
          height: rowH,
          borderColor: rgb(0.55, 0.55, 0.6),
          borderWidth: 0.5,
          color: cell.header ? rgb(0.94, 0.95, 0.97) : undefined,
        });
        cell.lines.forEach((line, i) => {
          this.drawLine(line, cell.x + pad, topY - pad - size - i * lh + (lh - size) / 4, size, "left", cell.w - pad * 2);
        });
      }
      this.y -= rowH;
    }
    this.y -= size * 0.8;
  }
}

function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.bold === p.bold && last.color === p.color && last.underline === p.underline) {
      last.text += p.text;
      last.width += p.width;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** 英数字の語はまとめ、和文は1文字ずつ、空白と改行は単独のトークンにする */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /\n|[ \t]+|[A-Za-z0-9@._\-+/:#%&=?~]+|[\s\S]/gu;
  for (const m of text.matchAll(re)) tokens.push(m[0]);
  return tokens;
}
