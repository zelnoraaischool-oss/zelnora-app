import { execFileSync } from "node:child_process";
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
    Utilities: { computeDigest: (_a: unknown, s: string) => Array.from(Buffer.from(s).subarray(0, 16)), DigestAlgorithm: { SHA_256: 1 } },
    UrlFetchApp: {
      fetch: (url: string) => {
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
  return { sandbox, props, books, triggers, mails, call };
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
});
