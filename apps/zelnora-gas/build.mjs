// Apps Script 用に1ファイルへまとめる（dist/Code.js と appsscript.json）
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const GLOBALS = ["doPost", "doGet", "onFormSubmitTrigger", "retryImportsJob", "dailyJob", "setup"];

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  globalName: "Zelnora",
  target: "es2019",
  platform: "neutral",
  mainFields: ["module", "main"],
  outfile: "dist/bundle.js",
  legalComments: "none",
  logLevel: "warning",
});
const bundle = readFileSync("dist/bundle.js", "utf8");
const stubs = GLOBALS.map((name) => `function ${name}(e) { return Zelnora.${name}(e); }`).join("\n");
writeFileSync("dist/Code.js", `${bundle}\n${stubs}\n`);
copyFileSync("appsscript.json", "dist/appsscript.json");
console.log("dist/Code.js を作成しました");
