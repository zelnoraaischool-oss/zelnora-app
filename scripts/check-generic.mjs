#!/usr/bin/env node
// 要件定義書 2.6「コードの中に商材名、プラン名、段階名、列名を書かない」をCIで確かめる。
// 商材固有の語は templates/*.json（設定データ）にだけ置く。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["packages/zelnora-core/src", "apps/zelnora-gas/src", "apps/zelnora-web/src"];
const FORBIDDEN = ["AES", "AIエンジニア", "受講", "コンサル", "アポ", "無料面談", "クラウド契約", "3か月プラン", "受講者登録"];

function* walk(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|html|css)$/.test(e)) yield p;
  }
}

let problems = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const w of FORBIDDEN) {
        if (line.includes(w)) {
          console.error(`${file}:${i + 1}: 商材固有の語「${w}」がコードに含まれています`);
          problems++;
        }
      }
    });
  }
}
if (problems) {
  console.error(`\n${problems}件。商材固有の語は templates/*.json や設定データに移してください。`);
  process.exit(1);
}
console.log("OK: コードに商材固有の語は含まれていません");
