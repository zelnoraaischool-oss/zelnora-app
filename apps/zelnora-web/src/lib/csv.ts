/** CSVを行と列に分ける（ダブルクォート・改行を含む値・BOMに対応） */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 見出しから項目を推測する */
export function guessField(header: string): string {
  const h = header.trim().toLowerCase();
  if (/ふりがな|フリガナ|kana|よみ/.test(h)) return "kana";
  if (/氏名|名前|お名前|^name$|顧客名/.test(h)) return "name";
  if (/メール|mail/.test(h)) return "email";
  if (/電話|tel|phone/.test(h)) return "phone";
  if (/会社|company|法人/.test(h)) return "company";
  if (/流入|経路|source|きっかけ/.test(h)) return "source";
  if (/メモ|備考|note/.test(h)) return "note";
  return "";
}
