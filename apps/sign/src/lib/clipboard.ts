/**
 * 非同期処理の結果をクリップボードへコピーする。
 * Safariはユーザー操作の直後でないと書き込めないため、Promiseを渡せるClipboardItemを優先する。
 */
export async function copyAsync(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // フォールバックへ
  }
  try {
    await navigator.clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
