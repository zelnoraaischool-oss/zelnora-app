import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 署名URL用トークン：256ビットの暗号学的乱数（base64url） */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** DBに保存するのはトークンのハッシュのみ */
export function hashToken(token: string): string {
  return sha256Hex(`sign-token:v1:${token}`);
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** 6桁のワンタイムパスワード */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** OTPはサーバー側の秘密値（ペッパー）付きHMACで保存する（6桁の総当たり逆算を防ぐ） */
export function hashOtp(code: string, challengeId: string, secret: string): string {
  return createHmac("sha256", secret).update(`otp:v1:${challengeId}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

function keyFrom(secret: string): Buffer {
  // 32バイト鍵（base64）でなければSHA-256で導出する
  const raw = Buffer.from(secret, "base64");
  return raw.length === 32 ? raw : createHash("sha256").update(secret).digest();
}

/** AES-256-GCMで暗号化（URL再コピー用。DBだけが漏れてもURLは復元できない） */
export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptString(payload: string, secret: string): string {
  const [v, iv, enc, tag] = payload.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("invalid ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC署名付きの小さなセッション値（署名者セッションCookie用） */
export function signPayload(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
