import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeBook } from "./fake-sheets";

// dist/Code.js を、Apps Script のグローバルを模した環境で動かす
function gasSandbox() {
  const props = new Map<string, string>([["OAUTH_CLIENT_ID", "client-123"]]);
  const books = new Map<string, FakeBook>();
  const tokens: Record<string, string> = { "tok-owner": "owner@example.com", "tok-stranger": "who@gmail.com" };
  const triggers: { fn: string }[] = [];
  const mails: { to: string; subject: string }[] = [];
  const cache = new Map<string, string>();
  // 電子契約システム（https://sign.test）の代わり
  const signCalls: { url: string; method: string; auth: string; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const signContracts: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const signApi = (url: string, opts: { method?: string; headers?: Record<string, string>; payload?: string }) => {
    const body = opts.payload ? JSON.parse(opts.payload) : null;
    signCalls.push({ url, method: opts.method ?? "get", auth: opts.headers?.Authorization ?? "", body });
    if (opts.headers?.Authorization !== "Bearer sign-key") return { ok: false, error: "APIキーが正しくありません" };
    if (url.endsWith("/api/integration/templates")) {
      return { ok: true, data: [{ id: "tpl-1", name: "申込書", variables: [{ key: "氏名", type: "text", filledBy: "admin", required: true }] }] };
    }
    if (url.endsWith("/api/integration/contracts") && opts.method === "post") {
      const id = "11111111-1111-4111-8111-111111111111";
      signContracts[id] = { contractId: id, externalRef: body.externalRef, status: "sent", signedAt: null, url: "https://sign.test/s#tok", adminUrl: `https://sign.test/admin/contracts/${id}` };
      return { ok: true, data: { ...signContracts[id], created: true, emailSent: true } };
    }
    return { ok: false, error: "not found" };
  };
  const chain = (fn: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["timeBased", "everyMinutes", "everyDays", "atHour", "inTimezone", "forForm", "onFormSubmit"]) b[m] = () => b;
    b.create = () => triggers.push({ fn });
    return b;
  };
  const sandbox: Record<string, unknown> = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    SpreadsheetApp: {
      openById: (id: string) => books.get(id) ?? (() => { const b = new FakeBook(id); books.set(id, b); return b; })(),
      create: () => { const b = new FakeBook(`db-${books.size + 1}`); books.set(b.getId(), b); return b; },
    },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => cache.set(k, v) }) },
    Utilities: {
      computeDigest: (_a: unknown, s: string) => Array.from(Buffer.from(s).subarray(0, 16)),
      DigestAlgorithm: { SHA_256: 1 },
      // Apps Script と同じく、符号付きのバイト列を返す
      computeHmacSha256Signature: (v: string, k: string) => Array.from(createHmac("sha256", k).update(v, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: {
      fetch: (url: string, opts: { method?: string; headers?: Record<string, string>; payload?: string } = {}) => {
        if (url.startsWith("https://sign.test/")) {
          const r = signApi(url, opts);
          return { getResponseCode: () => (r.ok ? 200 : 400), getContentText: () => JSON.stringify(r) };
        }
        const tok = decodeURIComponent(url.split("id_token=")[1] ?? "");
        const email = tokens[tok];
        return {
          getResponseCode: () => (email ? 200 : 400),
          getContentText: () => JSON.stringify({ aud: "client-123", email, email_verified: "true", exp: String(Math.floor(Date.now() / 1000) + 3600), iss: "https://accounts.google.com" }),
        };
      },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => ({ content: s }) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    ScriptApp: { getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, getTriggerSourceId: () => "" })), newTrigger: chain },
    MailApp: { sendEmail: (m: { to: string; subject: string }) => mails.push(m) },
    FormApp: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(__dirname, "../dist/Code.js"), "utf8"), sandbox);
  const call = (idToken: string, action: string, params: object = {}) => {
    const out = (sandbox.doPost as (e: unknown) => { content: string })({ postData: { contents: JSON.stringify({ idToken, action, params }) } });
    return JSON.parse(out.content) as { ok: boolean; data?: any; error?: string; code?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const webhook = (payload: object, secret = "hook-secret") => {
    const text = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(text).digest("hex");
    const out = (sandbox.doPost as (e: unknown) => { content: string })({ postData: { contents: JSON.stringify({ kind: "esign.webhook", payload: text, signature }) } });
    return JSON.parse(out.content) as { ok: boolean; data?: any; error?: string; code?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { sandbox, props, books, triggers, mails, call, webhook, signCalls, signContracts };
}

describe("Apps Script バンドル", () => {
  beforeAll(() => {
    execFileSync("node", ["build.mjs"], { cwd: path.join(__dirname, "..") });
  });

  it("setup でDBとトリガーを作り、IDトークンでAPIを呼べる", () => {
    const g = gasSandbox();
    (g.sandbox.setup as () => void)();
    expect(g.props.get("DB_SPREADSHEET_ID")).toBeTruthy();
    expect(g.triggers.map((t) => t.fn).sort()).toEqual(["dailyJob", "retryImportsJob"]);

    expect(g.call("bad-token", "session")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(g.call("tok-stranger", "session")).toMatchObject({ ok: false, code: "forbidden" });
    const s = g.call("tok-owner", "session");
    expect(s.ok).toBe(true);
    expect(s.data.user.role).toBe("owner");

    // 商材をテンプレートから作り、プランを登録して、リードを作る
    const product = g.call("tok-owner", "settings.productFromTemplate", { templateType: "school", name: "商材X" }).data;
    expect(g.call("tok-owner", "settings.saveProduct", { product }).ok).toBe(true);
    const plan = g.call("tok-owner", "settings.newPlan", { productId: product.id, plan: { name: "基本", priceIncl: 11000, priceExcl: 10000 } }).data;
    expect(g.call("tok-owner", "settings.savePlan", { plan }).ok).toBe(true);
    const lead = g.call("tok-owner", "deals.createLead", { lead: { customer: { name: "顧客 一郎", email: "ichiro@example.com" }, productId: product.id, planId: plan.id } });
    expect(lead.ok).toBe(true);
    const board = g.call("tok-owner", "deals.board", { productId: product.id, owner: "all" });
    expect(board.data.columns[0].cards).toHaveLength(1);

    // DBスプレッドシートにタブができ、月次売上の書き出し先もある
    const db = g.books.get(g.props.get("DB_SPREADSHEET_ID")!)!;
    expect([...db.sheets.keys()]).toEqual(expect.arrayContaining(["_settings", "customers", "deals", "users"]));
    g.call("tok-owner", "deals.move", { id: lead.data.deal.id, move: { stageId: "contract", paymentMethod: "振込", fields: { contactMethod: "電話", meetingAt: "2026-10-01" } } });
    const won = g.call("tok-owner", "deals.move", { id: lead.data.deal.id, move: { stageId: "won" } });
    expect(won.ok).toBe(true);
    expect(db.sheets.get("月次売上")!.data[1]).toEqual(expect.arrayContaining(["商材X", "基本", 1, 11000]));
    expect(db.sheets.has("データソース一覧")).toBe(true);
  });

  it("電子契約：契約の段階で契約書を作成し、署名完了の通知（HMAC）で成約にする", () => {
    const g = gasSandbox();
    (g.sandbox.setup as () => void)();
    g.props.set("ESIGN_API_KEY", "sign-key");
    g.props.set("ESIGN_WEBHOOK_SECRET", "hook-secret");
    const product = g.call("tok-owner", "settings.productFromTemplate", { templateType: "school", name: "商材Y" }).data;
    g.call("tok-owner", "settings.saveProduct", { product });
    const plan = g.call("tok-owner", "settings.newPlan", { productId: product.id, plan: { name: "基本", priceIncl: 11000, priceExcl: 10000 } }).data;
    g.call("tok-owner", "settings.savePlan", { plan });

    // URLを保存してから、テンプレートを読み込む
    expect(g.call("tok-owner", "esign.templates")).toMatchObject({ ok: false, error: expect.stringContaining("URL") });
    expect(g.call("tok-owner", "esign.saveSettings", { settings: { enabled: true, baseUrl: "https://sign.test" } }).ok).toBe(true);
    expect(g.call("tok-owner", "esign.templates")).toMatchObject({ ok: true, data: [{ id: "tpl-1" }] });
    expect(g.signCalls[0]).toMatchObject({ url: "https://sign.test/api/integration/templates", auth: "Bearer sign-key" });
    const saved = g.call("tok-owner", "esign.saveSettings", {
      settings: { enabled: true, baseUrl: "https://sign.test", plans: { [plan.id]: { templateId: "tpl-1", templateName: "申込書", values: { 氏名: "customer.name" } } } },
    });
    expect(saved.ok).toBe(true);

    const lead = g.call("tok-owner", "deals.createLead", { lead: { customer: { name: "顧客 二郎", email: "jiro@example.com" }, productId: product.id, planId: plan.id } });
    const dealId = lead.data.deal.id as string;
    const moved = g.call("tok-owner", "deals.move", { id: dealId, move: { stageId: "contract", paymentMethod: "振込", fields: { contactMethod: "電話", meetingAt: "2026-10-01" } } });
    expect(moved.ok).toBe(true);
    expect(moved.data.esignUrl).toBe("https://sign.test/s#tok");
    const create = g.signCalls.find((c) => c.method === "post")!;
    expect(create.body).toMatchObject({ templateId: "tpl-1", externalRef: dealId, values: { 氏名: "顧客 二郎" }, signer: { email: "jiro@example.com" } });

    const contractId = "11111111-1111-4111-8111-111111111111";
    const signed = { event: "contract.signed", contractId, externalRef: dealId, status: "signed", signedAt: new Date().toISOString(), sha256: "a".repeat(64), sentAt: new Date().toISOString() };
    // 署名が違う・古い通知は受け付けない
    expect(g.webhook(signed, "wrong")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(g.webhook({ ...signed, sentAt: "2020-01-01T00:00:00Z" })).toMatchObject({ ok: false, code: "unauthorized" });
    const r = g.webhook(signed);
    expect(r).toMatchObject({ ok: true, data: { dealId, won: true } });

    const deal = g.call("tok-owner", "deals.list", { filter: {} }).data.find((d: { id: string }) => d.id === dealId);
    expect(deal.status).toBe("won");
    expect(deal.esign.status).toBe("signed");
    // スプレッドシートに保存され、読み直しても電子契約の情報が残る
    const db = g.books.get(g.props.get("DB_SPREADSHEET_ID")!)!;
    const contracts = db.sheets.get("contracts")!.data;
    expect(contracts[0]).toContain("externalId");
    expect(contracts.flat()).toContain(contractId);
  });
});
