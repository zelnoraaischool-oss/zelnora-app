import { access, readFile } from "node:fs/promises";
import path from "node:path";

// Noto Sans JP（SIL Open Font License、assets/fonts/OFL.txt）をPDFに埋め込む。
// Vercel などのサーバー関数でも確実に読めるよう、フォントはアプリ内（assets/fonts）に同梱している。FONT_DIR で差し替え可能。
const REGULAR = "NotoSansJP_400Regular.ttf";
const BOLD = "NotoSansJP_700Bold.ttf";

let cache: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** フォントのファイルの場所（見つかった最初のもの） */
async function fontPaths(): Promise<{ regular: string; bold: string }> {
  const cwd = process.cwd();
  const candidates = [
    ...(process.env.FONT_DIR ? [{ regular: path.join(process.env.FONT_DIR, REGULAR), bold: path.join(process.env.FONT_DIR, BOLD) }] : []),
    { regular: path.join(cwd, "assets", "fonts", REGULAR), bold: path.join(cwd, "assets", "fonts", BOLD) },
    { regular: path.join(cwd, "apps", "sign", "assets", "fonts", REGULAR), bold: path.join(cwd, "apps", "sign", "assets", "fonts", BOLD) },
  ];
  for (const c of candidates) if ((await exists(c.regular)) && (await exists(c.bold))) return c;
  throw new Error(`PDF用のフォントが見つかりません（${candidates.map((c) => path.dirname(c.regular)).join(", ")}）`);
}

export function loadFonts() {
  if (!cache) {
    cache = fontPaths()
      .then((p) => Promise.all([readFile(p.regular), readFile(p.bold)]))
      .then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}
