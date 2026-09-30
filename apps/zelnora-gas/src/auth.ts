// Googleアカウントでのログイン：Web画面が取得したIDトークンを検証し、メールアドレスを得る
import { prop } from "./gas-env";

function sha256(s: string): string {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");
}

export function verifyIdToken(idToken: string): string {
  if (!idToken) throw new Error("ログインしてください");
  const cache = CacheService.getScriptCache();
  const key = `tok:${sha256(idToken)}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const res = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("ログインの有効期限が切れました。もう一度ログインしてください");
  const info = JSON.parse(res.getContentText()) as { aud: string; email: string; email_verified: string | boolean; exp: string; iss: string };
  const clientId = prop("OAUTH_CLIENT_ID");
  if (!clientId || info.aud !== clientId) throw new Error("このアプリ用のログインではありません");
  if (!(info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com")) throw new Error("発行元が正しくありません");
  if (!(info.email_verified === true || info.email_verified === "true")) throw new Error("メールアドレスが確認されていません");
  const ttl = Math.max(0, Math.min(300, Number(info.exp) - Math.floor(Date.now() / 1000) - 30));
  if (ttl > 0) cache?.put(key, info.email.toLowerCase(), ttl);
  return info.email.toLowerCase();
}
