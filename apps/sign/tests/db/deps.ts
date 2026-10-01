import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inject } from "vitest";
import { createDb } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import { OutboxMailer } from "@/lib/server/mailer";
import { LocalDocumentStorage } from "@/lib/server/storage";
import { requestTimestamp } from "@/lib/tsa/client";
import { devTsaRespond } from "@/lib/tsa/dev-tsa";

export function testDeps(opts: { tsaDown?: () => boolean } = {}) {
  const mailer = new OutboxMailer();
  const storageDir = mkdtempSync(path.join(tmpdir(), "sign-docs-"));
  const d: Deps = {
    db: createDb(inject("databaseUrl")),
    storage: new LocalDocumentStorage(storageDir),
    mailer,
    timestamp: async (hash) => {
      if (opts.tsaDown?.()) throw new Error("TSA unavailable (test)");
      return requestTimestamp(hash, {
        url: "https://tsa.test",
        fetchImpl: (async (_u: string | URL | Request, init?: RequestInit) =>
          new Response(Buffer.from(await devTsaRespond(new Uint8Array(init!.body as Buffer))))) as typeof fetch,
      });
    },
    now: () => new Date(),
    secrets: { session: "test-session-secret", otp: "test-otp-secret", tokenEncryption: "test-token-key" },
    appUrl: "https://sign.test",
    integration: {
      apiKey: "test-integration-key",
      webhookUrl: "https://crm.test/hook",
      webhookSecret: "test-webhook-secret",
      fetch: (async () => new Response("{}")) as typeof fetch,
    },
  };
  return { d, mailer, storageDir };
}

export function lastMailTo(mailer: OutboxMailer, to: string) {
  const m = [...mailer.sent].reverse().find((x) => x.to === to);
  if (!m) throw new Error(`no mail to ${to}`);
  return m;
}

export function extractToken(text: string): string {
  const m = /https:\/\/sign\.test\/s#([A-Za-z0-9_-]{43})/.exec(text);
  if (!m?.[1]) throw new Error("no signing url in mail");
  return m[1];
}

export function extractOtp(text: string): string {
  const m = /確認コード：(\d{6})/.exec(text);
  if (!m?.[1]) throw new Error("no otp in mail");
  return m[1];
}
