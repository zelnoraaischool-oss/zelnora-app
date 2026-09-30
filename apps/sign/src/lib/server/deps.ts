import "server-only";
import path from "node:path";
import { createDb, type Db } from "./db";
import { type Mailer, OutboxMailer, ResendMailer } from "./mailer";
import { type DocumentStorage, LocalDocumentStorage, SupabaseDocumentStorage } from "./storage";
import { requestTimestamp, type TimestampResult } from "../tsa/client";
import { devTsaRespond } from "../tsa/dev-tsa";

export interface Deps {
  db: Db;
  storage: DocumentStorage;
  mailer: Mailer;
  timestamp: (sha256Hex: string) => Promise<TimestampResult>;
  now: () => Date;
  secrets: { session: string; otp: string; tokenEncryption: string };
  appUrl: string;
}

let current: Deps | null = null;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

function must(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  return v;
}

function secret(name: string): string {
  const v = env(name);
  if (v) return v;
  if (process.env.NODE_ENV === "production") throw new Error(`環境変数 ${name} が設定されていません`);
  return `dev-insecure-${name}`;
}

function buildDeps(): Deps {
  const dataDir = path.resolve(env("LOCAL_DATA_DIR") ?? ".data");
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const storage: DocumentStorage =
    env("STORAGE_DRIVER") === "local" || !supabaseUrl || !serviceKey
      ? new LocalDocumentStorage(path.join(dataDir, "documents"))
      : new SupabaseDocumentStorage(supabaseUrl, serviceKey);
  const resendKey = env("RESEND_API_KEY");
  const mailer: Mailer = resendKey
    ? new ResendMailer(resendKey, must("MAIL_FROM"))
    : new OutboxMailer(path.join(dataDir, "outbox.jsonl"));
  const tsaUrl = env("TSA_URL");
  const timestamp = async (hash: string): Promise<TimestampResult> => {
    if (tsaUrl === "dev") {
      if (process.env.NODE_ENV === "production" && env("ALLOW_DEV_TSA") !== "1") {
        throw new Error("開発用TSAは本番では使用できません");
      }
      return requestTimestamp(hash, {
        url: "dev",
        fetchImpl: (async (_u: string | URL | Request, init?: RequestInit) =>
          new Response(Buffer.from(await devTsaRespond(new Uint8Array(init!.body as Buffer))))) as typeof fetch,
      });
    }
    if (!tsaUrl) throw new Error("TSA_URL が設定されていません");
    return requestTimestamp(hash, {
      url: tsaUrl,
      username: env("TSA_USERNAME"),
      password: env("TSA_PASSWORD"),
      timeoutMs: Number(env("TSA_TIMEOUT_MS") ?? 5000),
    });
  };
  return {
    db: createDb(must("DATABASE_URL")),
    storage,
    mailer,
    timestamp,
    now: () => new Date(),
    secrets: {
      session: secret("SESSION_SECRET"),
      otp: secret("OTP_SECRET"),
      tokenEncryption: secret("TOKEN_ENCRYPTION_KEY"),
    },
    appUrl: (env("APP_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
  };
}

export function deps(): Deps {
  if (!current) current = buildDeps();
  return current;
}

/** テスト用に依存を差し替える */
export function setDeps(d: Deps | null): void {
  current = d;
}
