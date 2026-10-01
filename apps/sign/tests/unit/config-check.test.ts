import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { missingConfig } = await import("@/lib/server/config-check");

describe("初期設定の確認", () => {
  it("本番で足りない環境変数の名前を返す（値は返さない）", () => {
    const names = missingConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }).map((m) => m.name);
    expect(names).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(names).toContain("RESEND_API_KEY");
    expect(names).not.toContain("DATABASE_URL");
  });

  it("開発用ログインではDBとTSAだけでよい", () => {
    expect(missingConfig({ NODE_ENV: "development", AUTH_DRIVER: "dev", DATABASE_URL: "x", TSA_URL: "dev" })).toEqual([]);
  });

  it("すべて設定済みなら空", () => {
    const env = Object.fromEntries(missingConfig({ NODE_ENV: "production" }).map((m) => [m.name, "set"]));
    expect(missingConfig({ NODE_ENV: "production", ...env })).toEqual([]);
  });
});
