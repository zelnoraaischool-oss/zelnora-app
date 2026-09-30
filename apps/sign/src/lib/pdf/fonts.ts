import { readFile } from "node:fs/promises";
import path from "node:path";

// Noto Sans JP（SIL Open Font License）をPDFに埋め込む。FONT_DIR で差し替え可能。
const DEFAULT_DIR = path.join(process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans-jp");

let cache: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

export function loadFonts() {
  if (!cache) {
    const dir = process.env.FONT_DIR ?? DEFAULT_DIR;
    cache = Promise.all([
      readFile(path.join(dir, "400Regular", "NotoSansJP_400Regular.ttf")),
      readFile(path.join(dir, "700Bold", "NotoSansJP_700Bold.ttf")),
    ])
      .then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}
