import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { buildTimeStampRequest, parseTimeStampResponse, requestTimestamp, TsaError } from "@/lib/tsa/client";
import { devTsaRespond } from "@/lib/tsa/dev-tsa";

const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = new Uint8Array(init!.body as Buffer);
  const der = await devTsaRespond(body);
  return new Response(Buffer.from(der), { status: 200, headers: { "Content-Type": "application/timestamp-reply" } });
}) as typeof fetch;

describe("RFC 3161 タイムスタンプ", () => {
  it("ハッシュに対するトークンを取得し、時刻とシリアルを取り出せる", async () => {
    const hash = sha256Hex("契約書PDF");
    const r = await requestTimestamp(hash, { url: "https://tsa.test", fetchImpl: fakeFetch });
    expect(r.token.length).toBeGreaterThan(100);
    expect(Math.abs(r.genTime.getTime() - Date.now())).toBeLessThan(10_000);
    expect(r.serial).not.toBe("");
  });

  it("別のハッシュへの応答は拒否する", async () => {
    const reqDer = buildTimeStampRequest(sha256Hex("A"), new Uint8Array([1, 2, 3]));
    const resp = await devTsaRespond(reqDer);
    await expect(parseTimeStampResponse(resp, sha256Hex("B"))).rejects.toBeInstanceOf(TsaError);
  });

  it("nonceが違う応答は拒否する", async () => {
    const hash = sha256Hex("A");
    const resp = await devTsaRespond(buildTimeStampRequest(hash, new Uint8Array([1, 2, 3])));
    await expect(parseTimeStampResponse(resp, hash, new Uint8Array([9, 9, 9]))).rejects.toThrow(/nonce/);
    await expect(parseTimeStampResponse(resp, hash, new Uint8Array([1, 2, 3]))).resolves.toBeTruthy();
  });

  it("接続できない・HTTPエラーは TsaError になる", async () => {
    const failing = (async () => new Response("no", { status: 503 })) as typeof fetch;
    await expect(requestTimestamp(sha256Hex("x"), { url: "https://tsa.test", fetchImpl: failing })).rejects.toBeInstanceOf(TsaError);
    const throwing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(requestTimestamp(sha256Hex("x"), { url: "https://tsa.test", fetchImpl: throwing })).rejects.toThrow(/接続できません/);
  });
});
