import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { sha256Hex } from "@/lib/crypto";
import { cancelContract, createContract, getContractDetail, reissueToken, revokeTokens, searchContracts } from "@/lib/server/contracts";
import {
  finalizeSignature,
  getSignerDocument,
  markRead,
  openContract,
  processTimestampJobs,
  requestOtp,
  saveSignerValues,
  verifyOtp,
} from "@/lib/server/signing";
import { createTemplate, publishDraft, saveDraft } from "@/lib/server/templates";
import type { Actor } from "@/lib/server/types";
import { connect, createAdmin } from "./helpers";
import { extractOtp, extractToken, lastMailTo, testDeps } from "./deps";

const client = { ip: "203.0.113.10", userAgent: "Mozilla/5.0 (iPhone) test" };
let pg: Client;
let owner: Actor;
let tsaDown = false;
const { d, mailer, storageDir } = testDeps({ tsaDown: () => tsaDown });
let templateId: string;

beforeAll(async () => {
  pg = await connect();
  const a = await createAdmin(pg, "owner");
  owner = { id: a.id, email: a.email, role: "owner" };
  const t = await createTemplate(d.db, owner, { name: "受講契約書" });
  templateId = t.id;
  await saveDraft(d.db, owner, templateId, {
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, numbered: true }, content: [{ type: "text", text: "（目的）" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "{{発注者名}}（以下「乙」）と" },
            { type: "variable", attrs: { key: "受講者氏名" } },
            { type: "text", text: "（以下「甲」）は、受講料{{受講料}}で契約する。甲の住所は{{住所}}とする。" },
          ],
        },
      ],
    },
    variables: [
      { key: "受講者氏名", type: "text", filledBy: "admin", required: true },
      { key: "受講料", type: "money", filledBy: "admin", required: true, defaultValue: "30000" },
      { key: "契約日", type: "date", filledBy: "admin", required: true },
      { key: "住所", type: "address", filledBy: "signer", required: true },
    ],
    confirm_screen_items: { price: "{{受講料}}（税込）", cancellation: "受講開始後の返金はできません" },
    key_clauses: [{ id: "refund", title: "返金不可", description: "受講開始後の返金はできません" }],
    amount_variable_key: "受講料",
    transaction_date_variable_key: "契約日",
    email_subject: "【ご確認ください】{{契約名}}",
    email_body: "",
  });
  await publishDraft(d.db, owner, templateId);
});

afterAll(async () => {
  await pg.end();
});

async function newContract(email: string, channels: ("url" | "email")[] = ["email"], name = "山田 太郎") {
  const r = await createContract(d, owner, {
    templateId,
    signer: { name, email },
    values: { 受講者氏名: name, 受講料: "30,000", 契約日: "2026-09-30" },
    channels,
  });
  return r;
}

async function verifySigner(token: string, email: string) {
  await requestOtp(d, token, email, client);
  const code = extractOtp(lastMailTo(mailer, email).text);
  const { session } = await verifyOtp(d, token, code, client);
  return session;
}

describe("署名フロー（受け入れ基準2・3・7・8）", () => {
  it("メール送付→本人確認→全文表示→入力→同意→署名→確定版PDFまで完了する", async () => {
    const email = "taro@example.com";
    const created = await newContract(email);
    expect(created.sent.email).toBe(true);
    const invite = lastMailTo(mailer, email);
    const token = extractToken(invite.text);
    expect(created.url).toBe(`https://sign.test/s#${token}`);

    const opened = await openContract(d, token, undefined, client);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.info.otpMode).toBe("registered_email");
    expect(opened.info.verified).toBe(false);
    // 本人確認前は本文を取得できない
    await expect(getSignerDocument(d, token, undefined)).rejects.toMatchObject({ code: "unverified" });

    await requestOtp(d, token, null, client);
    const code = extractOtp(lastMailTo(mailer, email).text);
    await expect(verifyOtp(d, token, code === "000000" ? "111111" : "000000", client)).rejects.toMatchObject({ code: "otp_invalid" });
    const { session } = await verifyOtp(d, token, code, client);

    const doc = await getSignerDocument(d, token, session);
    expect(JSON.stringify(doc.body)).toContain("30,000円");
    expect(JSON.stringify(doc.body)).toContain("AIエンジニアスクール");
    expect(doc.signerVariables.map((v) => v.key)).toEqual(["住所"]);
    expect(doc.confirmItems.find((c) => c.key === "price")?.text).toBe("30,000円（税込）");

    const baseInput = {
      consents: { content: true, privacy: true, keyClauses: { refund: true } },
      signedName: "山田太郎",
    };
    await expect(finalizeSignature(d, token, session, baseInput, client)).rejects.toMatchObject({ code: "not_read" });
    await markRead(d, token, session, client);

    const bad = await saveSignerValues(d, token, session, { 住所: "" }, client);
    expect(bad.ok).toBe(false);
    await expect(finalizeSignature(d, token, session, baseInput, client)).rejects.toMatchObject({ code: "invalid_values" });
    const good = await saveSignerValues(d, token, session, { 住所: "東京都千代田区1-1" }, client);
    expect(good.ok).toBe(true);

    await expect(
      finalizeSignature(d, token, session, { ...baseInput, consents: { ...baseInput.consents, keyClauses: {} } }, client),
    ).rejects.toMatchObject({ code: "consent" });
    await expect(finalizeSignature(d, token, session, { ...baseInput, signedName: "山田花子" }, client)).rejects.toMatchObject({
      code: "name_mismatch",
    });

    const result = await finalizeSignature(d, token, session, baseInput, client);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.timestamped).toBe(true);

    // 保存されたPDFのハッシュが記録と一致し、検証関数で照合できる
    const detail = await getContractDetail(d.db, created.contractId);
    expect(detail.contract.status).toBe("signed");
    expect(detail.contract.amount).toBe("30000");
    expect(detail.contract.transaction_date).toBe("2026-09-30");
    const docRow = detail.documents[0]!;
    const bytes = readFileSync(path.join(storageDir, docRow.storage_path));
    expect(sha256Hex(bytes)).toBe(docRow.sha256);
    expect(detail.timestamps.map((t) => t.target).sort()).toEqual(["content", "pdf"]);

    const match = await pg.query("select * from public.verify_document($1)", [sha256Hex(bytes)]);
    expect(match.rows).toHaveLength(1);
    // 1バイトでも書き換えると一致しない
    const tampered = Buffer.from(bytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    const noMatch = await pg.query("select * from public.verify_document($1)", [sha256Hex(tampered)]);
    expect(noMatch.rows).toHaveLength(0);

    // 署名者にも管理者と同じ確定版PDFが送られる
    const done = lastMailTo(mailer, email);
    expect(done.subject).toContain("締結完了");
    expect(sha256Hex(done.attachments![0]!.content)).toBe(docRow.sha256);

    // 監査ログに一連の手順が残る
    const types = detail.events.map((e) => e.event_type);
    for (const t of [
      "contract.created",
      "token.issued",
      "contract.sent",
      "contract.viewed",
      "otp.requested",
      "otp.failed",
      "otp.verified",
      "document.read_completed",
      "values.saved",
      "consent.given",
      "contract.signed",
      "document.generated",
      "timestamp.granted",
    ]) {
      expect(types, t).toContain(t);
    }

    // 署名後は同じURLで閲覧専用（再度の本人確認で本文を見られる）
    const again = await openContract(d, token, session, client);
    expect(again.ok && again.info.status).toBe("signed");
    const view = await getSignerDocument(d, token, session);
    expect(view.status).toBe("signed");
    expect(view.documentSha256).toBe(docRow.sha256);
    await expect(finalizeSignature(d, token, session, baseInput, client)).rejects.toMatchObject({ code: "conflict" });

    const chain = await pg.query("select * from public.verify_audit_chain()");
    expect(chain.rows[0].ok).toBe(true);
  });

  it("URLコピーで送った場合は、署名者が入力したアドレスで本人確認する（登録アドレスと不一致なら拒否）", async () => {
    const email = "copy@example.com";
    const created = await newContract(email, ["url"], "佐藤 花子");
    const token = created.url.split("#")[1]!;
    const opened = await openContract(d, token, undefined, client);
    expect(opened.ok && opened.info.otpMode).toBe("input_email");
    await expect(requestOtp(d, token, "other@example.com", client)).rejects.toThrow(/一致しません/);
    const session = await verifySigner(token, email);
    const doc = await getSignerDocument(d, token, session);
    expect(doc.signerName).toBe("佐藤 花子");
  });
});

describe("トークンなし・無効なトークンでは契約書を閲覧できない（受け入れ基準7）", () => {
  it("トークンなし・不正な形式・存在しないトークン", async () => {
    for (const t of [undefined, "", "abc", "A".repeat(43)]) {
      const r = await openContract(d, t, undefined, client);
      expect(r.ok).toBe(false);
      await expect(getSignerDocument(d, t, undefined)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("無効化・期限切れ・取消のURLは、本人確認済みでも本文を返さない", async () => {
    // 無効化
    const a = await newContract("revoke@example.com", ["email"], "無効 太郎");
    const ta = a.url.split("#")[1]!;
    const sa = await verifySigner(ta, "revoke@example.com");
    expect((await getSignerDocument(d, ta, sa)).title).toContain("無効 太郎");
    await revokeTokens(d, owner, a.contractId, "テスト");
    const ra = await openContract(d, ta, sa, client);
    expect(ra.ok || ra.reason).toBe("revoked");
    await expect(getSignerDocument(d, ta, sa)).rejects.toMatchObject({ code: "revoked" });

    // 再発行すると旧URLは使えず、新URLが使える
    const re = await reissueToken(d, owner, a.contractId, {});
    const newToken = re.url.split("#")[1]!;
    expect((await openContract(d, newToken, undefined, client)).ok).toBe(true);
    await expect(getSignerDocument(d, newToken, sa)).rejects.toMatchObject({ code: "unverified" });

    // 期限切れ
    const b = await newContract("expire@example.com", ["email"], "期限 太郎");
    const tb = b.url.split("#")[1]!;
    const sb = await verifySigner(tb, "expire@example.com");
    await pg.query("update public.access_tokens set expires_at = now() - interval '1 second' where contract_party_id = (select id from public.contract_parties where contract_id = $1)", [b.contractId]);
    const rb = await openContract(d, tb, sb, client);
    expect(rb.ok || rb.reason).toBe("expired");
    await expect(getSignerDocument(d, tb, sb)).rejects.toMatchObject({ code: "expired" });

    // 取消
    const c = await newContract("cancel@example.com", ["email"], "取消 太郎");
    const tc = c.url.split("#")[1]!;
    const sc = await verifySigner(tc, "cancel@example.com");
    await cancelContract(d, owner, c.contractId, "申込の撤回");
    await expect(getSignerDocument(d, tc, sc)).rejects.toMatchObject({ code: "canceled" });
    const detail = await getContractDetail(d.db, c.contractId);
    expect(detail.token?.revoked_at).not.toBeNull();
  });

  it("他の契約のセッションでは本文を見られない", async () => {
    const a = await newContract("sess-a@example.com", ["email"], "甲 太郎");
    const b = await newContract("sess-b@example.com", ["email"], "乙 太郎");
    const sa = await verifySigner(a.url.split("#")[1]!, "sess-a@example.com");
    await expect(getSignerDocument(d, b.url.split("#")[1]!, sa)).rejects.toMatchObject({ code: "unverified" });
  });
});

describe("ワンタイムパスワード", () => {
  it("5回失敗するとロックされ、正しいコードでも通らない", async () => {
    const email = "lock@example.com";
    const c = await newContract(email, ["email"], "ロック 太郎");
    const token = c.url.split("#")[1]!;
    await requestOtp(d, token, null, client);
    const code = extractOtp(lastMailTo(mailer, email).text);
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 4; i++) await expect(verifyOtp(d, token, wrong, client)).rejects.toMatchObject({ code: "otp_invalid" });
    await expect(verifyOtp(d, token, wrong, client)).rejects.toMatchObject({ code: "locked" });
    await expect(verifyOtp(d, token, code, client)).rejects.toMatchObject({ code: "locked" });
    await expect(requestOtp(d, token, null, client)).rejects.toMatchObject({ code: "locked" });
  });

  it("有効期限（10分）を過ぎたコードは使えない", async () => {
    const email = "otpexp@example.com";
    const c = await newContract(email, ["email"], "期限 花子");
    const token = c.url.split("#")[1]!;
    await requestOtp(d, token, null, client);
    const code = extractOtp(lastMailTo(mailer, email).text);
    await pg.query(
      "update public.otp_challenges set expires_at = now() - interval '1 second' where contract_party_id = (select id from public.contract_parties where contract_id = $1)",
      [c.contractId],
    );
    await expect(verifyOtp(d, token, code, client)).rejects.toMatchObject({ code: "otp_expired" });
  });

  it("短時間の再送は制限される", async () => {
    const email = "rate@example.com";
    const c = await newContract(email, ["email"], "連続 太郎");
    const token = c.url.split("#")[1]!;
    await requestOtp(d, token, null, client);
    await expect(requestOtp(d, token, null, client)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("タイムスタンプ局に接続できない場合", () => {
  it("署名は完了し、未付与として再試行キューに入り、後で付与される", async () => {
    const email = "tsa@example.com";
    const c = await newContract(email, ["email"], "時刻 太郎");
    const token = c.url.split("#")[1]!;
    const session = await verifySigner(token, email);
    await markRead(d, token, session, client);
    await saveSignerValues(d, token, session, { 住所: "大阪府大阪市1-1" }, client);
    tsaDown = true;
    const r = await finalizeSignature(
      d,
      token,
      session,
      { consents: { content: true, privacy: true, keyClauses: { refund: true } }, signedName: "時刻太郎" },
      client,
    );
    expect(r.timestamped).toBe(false);
    const list = await searchContracts(d.db, { q: "時刻" });
    expect(list.rows[0]!.timestamp_pending).toBe(true);

    tsaDown = false;
    await pg.query("update public.timestamp_jobs set next_attempt_at = now() where document_id = $1", [r.documentId]);
    const res = await processTimestampJobs(d);
    expect(res.succeeded).toBeGreaterThanOrEqual(1);
    const after = await searchContracts(d.db, { q: "時刻" });
    expect(after.rows[0]!.timestamp_pending).toBe(false);
  });
});

describe("受け入れ基準9: 日付・金額・取引先の組み合わせ検索", () => {
  it("範囲と取引先を組み合わせて検索できる", async () => {
    await createContract(d, owner, {
      templateId,
      signer: { name: "検索 一郎", email: "s1@example.com", company: "株式会社サーチ" },
      values: { 受講者氏名: "検索 一郎", 受講料: "50000", 契約日: "2026-08-15" },
      channels: ["url"],
    });
    await createContract(d, owner, {
      templateId,
      signer: { name: "検索 二郎", email: "s2@example.com" },
      values: { 受講者氏名: "検索 二郎", 受講料: "120000", 契約日: "2026-10-01" },
      channels: ["url"],
    });
    const r1 = await searchContracts(d.db, { dateFrom: "2026-08-01", dateTo: "2026-08-31", amountMin: "40000", amountMax: "60000", counterparty: "サーチ" });
    expect(r1.rows.map((r) => r.signer_name)).toEqual(["検索 一郎"]);
    const r2 = await searchContracts(d.db, { amountMin: "100000" });
    expect(r2.rows.map((r) => r.signer_name)).toContain("検索 二郎");
    expect(r2.rows.map((r) => r.signer_name)).not.toContain("検索 一郎");
    const r3 = await searchContracts(d.db, { dateFrom: "2026-09-01", counterparty: "サーチ" });
    expect(r3.rows).toHaveLength(0);
  });
});
