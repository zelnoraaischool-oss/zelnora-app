import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importExistingContract } from "@/lib/server/archive";
import { cancelContract, getContractDetail, searchContracts } from "@/lib/server/contracts";
import {
  checkApiKey,
  createIntegrationContract,
  deliverPendingWebhooks,
  getIntegrationStatus,
  listIntegrationTemplates,
} from "@/lib/server/integration";
import { finalizeSignature, markRead, requestOtp, verifyOtp } from "@/lib/server/signing";
import { createTemplate, publishDraft, saveDraft } from "@/lib/server/templates";
import type { Actor } from "@/lib/server/types";
import { extractOtp, lastMailTo, testDeps } from "./deps";
import { connect, createAdmin } from "./helpers";

const client = { ip: "203.0.113.20", userAgent: "integration-test" };
let pg: Client;
let owner: Actor;
const { d, mailer } = testDeps();
let templateId: string;

// 通知の送信先（連携先）の代わり
const received: { url: string; body: string }[] = [];
let webhookFails = false;
d.integration.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  received.push({ url: String(url), body: String(init?.body ?? "") });
  if (webhookFails) return new Response("down", { status: 503 });
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

async function samplePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(text, { x: 10, y: 100, size: 12 });
  doc.setCreationDate(new Date("2025-04-01T00:00:00Z"));
  doc.setModificationDate(new Date("2025-04-01T00:00:00Z"));
  return doc.save();
}

beforeAll(async () => {
  pg = await connect();
  const a = await createAdmin(pg, "owner");
  owner = { id: a.id, email: a.email, role: "owner" };
  const t = await createTemplate(d.db, owner, { name: "連携テスト契約" });
  templateId = t.id;
  await saveDraft(d.db, owner, templateId, {
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "{{氏名}}は{{金額}}を支払う。" }] }] },
    variables: [
      { key: "氏名", type: "text", filledBy: "admin", required: true },
      { key: "金額", type: "money", filledBy: "admin", required: true },
    ],
    amount_variable_key: "金額",
  });
  await publishDraft(d.db, owner, templateId);
});

afterAll(async () => {
  await pg.end();
});

describe("既存の契約書の格納", () => {
  it("PDFを格納すると締結済みの契約として検索でき、原本は変更・削除できない", async () => {
    const bytes = await samplePdf("signed on paper");
    const r = await importExistingContract(
      d,
      owner,
      {
        title: "業務委託契約書（2025年度）",
        counterpartyName: "株式会社サンプル",
        signerName: "佐藤 一郎",
        signerEmail: "sato@example.com",
        signedDate: "2025-04-01",
        amount: "1,200,000",
        note: "紙で締結。原本は金庫に保管",
        filename: "業務委託契約書.pdf",
        bytes,
      },
      client,
    );
    expect(r.contract.status).toBe("signed");
    expect(r.contract.source).toBe("imported");
    expect(r.timestamped).toBe(true);

    const detail = await getContractDetail(d.db, r.contract.id);
    expect(detail.version).toBeNull();
    expect(detail.party?.name).toBe("佐藤 一郎");
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]).toMatchObject({ kind: "original", filename: "業務委託契約書.pdf", sha256: r.sha256 });
    expect(detail.timestamps.map((t) => t.target)).toEqual(["pdf"]);
    expect(detail.events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(["contract.imported", "document.stored", "timestamp.granted"]),
    );

    // 検索：取引先・金額・日付、格納分だけの絞り込み
    const found = await searchContracts(d.db, { counterparty: "サンプル", amountMin: "1000000", dateFrom: "2025-04-01", dateTo: "2025-04-01" });
    expect(found.rows.map((x) => x.id)).toContain(r.contract.id);
    expect(found.rows.find((x) => x.id === r.contract.id)?.template_name).toBe("既存の契約書（格納）");
    const onlyImported = await searchContracts(d.db, { source: "imported" });
    expect(onlyImported.rows.every((x) => x.source === "imported")).toBe(true);

    // 検証ページ：原本として照合できる
    const v = await pg.query("select * from public.verify_document($1)", [r.sha256]);
    expect(v.rows[0]).toMatchObject({ kind: "original" });

    // 改ざんできない（DB所有者の権限でも）
    await expect(pg.query("update public.contracts set title = 'x' where id = $1", [r.contract.id])).rejects.toThrow(/immutable/);
    await expect(pg.query("update public.documents set sha256 = repeat('0', 64) where contract_id = $1", [r.contract.id])).rejects.toThrow(
      /immutable/,
    );
    await expect(pg.query("delete from public.documents where contract_id = $1", [r.contract.id])).rejects.toThrow(/immutable/);
    await expect(pg.query("delete from public.contracts where id = $1", [r.contract.id])).rejects.toThrow(/immutable/);

    // 同じファイルは二重に格納しない
    await expect(
      importExistingContract(d, owner, { title: "重複", counterpartyName: "A", signedDate: "2025-04-01", filename: "a.pdf", bytes }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("PDF以外・未来の締結日・必須項目の不足は受け付けない", async () => {
    const pdf = await samplePdf("another");
    const base = { title: "契約", counterpartyName: "A", signedDate: "2025-01-01", filename: "a.pdf", bytes: pdf };
    await expect(importExistingContract(d, owner, { ...base, bytes: new TextEncoder().encode("PK\u0003\u0004 docx") })).rejects.toThrow(/PDF/);
    await expect(importExistingContract(d, owner, { ...base, signedDate: "2999-01-01" })).rejects.toThrow(/未来/);
    await expect(importExistingContract(d, owner, { ...base, counterpartyName: " " })).rejects.toThrow(/相手方/);
    await expect(importExistingContract(d, owner, { ...base, amount: "abc" })).rejects.toThrow(/金額/);
  });

  it("DBの制約：格納の契約を署名済みで直接作れない・テンプレートの契約に原本を足せない", async () => {
    await expect(
      pg.query(`insert into public.contracts (source, title, status, expires_at, signed_at) values ('imported', 'x', 'signed', now(), now())`),
    ).rejects.toThrow(/inserted as signed/);
    await expect(
      pg.query(`insert into public.contracts (source, title, status, expires_at) values ('template', 'x', 'draft', now())`),
    ).rejects.toThrow();
    const c = await createIntegrationContract(d, {
      templateId,
      externalRef: "guard-test",
      signer: { name: "テスト" },
      values: { 氏名: "テスト", 金額: "1000" },
    });
    await expect(
      pg.query(
        `insert into public.documents (contract_id, kind, storage_path, sha256, size_bytes) values ($1, 'original', 'x/y.pdf', repeat('a', 64), 1)`,
        [c.contractId],
      ),
    ).rejects.toThrow(/original documents/);
  });
});

describe("外部システム（顧客管理）との連携", () => {
  it("APIキーを確かめる", () => {
    expect(checkApiKey(d, "Bearer test-integration-key")).toBe(true);
    expect(checkApiKey(d, "Bearer wrong")).toBe(false);
    expect(checkApiKey(d, "test-integration-key")).toBe(false);
    expect(checkApiKey(d, null)).toBe(false);
    expect(checkApiKey({ ...d, integration: { ...d.integration, apiKey: undefined } }, "Bearer ")).toBe(false);
  });

  it("テンプレートの一覧 → 作成（再送しても1件）→ 署名 → 署名済みの通知（HMAC署名付き）", async () => {
    const templates = await listIntegrationTemplates(d.db);
    const t = templates.find((x) => x.id === templateId)!;
    expect(t.variables.map((v) => v.key)).toEqual(["氏名", "金額"]);

    const req = {
      templateId,
      externalRef: "deal_123",
      signer: { name: "高橋 花子", email: "hanako@example.com" },
      values: { 氏名: "高橋 花子", 金額: "330000" },
      sendEmail: true,
    };
    const first = await createIntegrationContract(d, req);
    expect(first.created).toBe(true);
    expect(first.url).toMatch(/^https:\/\/sign\.test\/s#/);
    expect(first.emailSent).toBe(true);
    const again = await createIntegrationContract(d, req);
    expect(again.created).toBe(false);
    expect(again.contractId).toBe(first.contractId);
    expect(again.url).toBe(first.url);

    const status = await getIntegrationStatus(d, { externalRef: "deal_123" });
    expect(status).toMatchObject({ contractId: first.contractId, status: "sent", signedAt: null });
    await expect(getIntegrationStatus(d, { externalRef: "none" })).rejects.toMatchObject({ status: 404 });

    // 署名
    const token = first.url!.split("#")[1]!;
    await requestOtp(d, token, null, client);
    const code = extractOtp(lastMailTo(mailer, "hanako@example.com").text);
    const { session } = await verifyOtp(d, token, code, client);
    await markRead(d, token, session, client);
    received.length = 0;
    const signed = await finalizeSignature(d, token, session, { consents: { content: true, privacy: true, keyClauses: {} }, signedName: "高橋花子" }, client);

    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe("https://crm.test/hook");
    const body = JSON.parse(received[0]!.body) as { kind: string; payload: string; signature: string };
    expect(body.kind).toBe("esign.webhook");
    const expected = createHmac("sha256", "test-webhook-secret").update(body.payload).digest("hex");
    expect(body.signature).toBe(expected);
    const payload = JSON.parse(body.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ event: "contract.signed", contractId: first.contractId, externalRef: "deal_123", status: "signed", sha256: signed.sha256 });
    // 秘密の情報（署名URL）は通知に含めない
    expect(body.payload).not.toContain(token);

    const after = await getIntegrationStatus(d, { contractId: first.contractId });
    expect(after.status).toBe("signed");
    expect(after.url).toBeNull();
    const detail = await getContractDetail(d.db, first.contractId);
    expect(detail.events.map((e) => e.event_type)).toContain("integration.notified");
    expect(detail.contract.external_ref).toBe("deal_123");
  });

  it("通知に失敗したら定期実行で再送する（取消の通知）", async () => {
    const c = await createIntegrationContract(d, {
      templateId,
      externalRef: "deal_456",
      signer: { name: "伊藤" },
      values: { 氏名: "伊藤", 金額: "1000" },
    });
    webhookFails = true;
    received.length = 0;
    await cancelContract(d, owner, c.contractId, "顧客の都合");
    expect(received).toHaveLength(1);
    const pending = await pg.query("select * from public.webhook_deliveries where contract_id = $1", [c.contractId]);
    expect(pending.rows[0]).toMatchObject({ event: "contract.canceled", delivered_at: null, attempts: 1 });

    webhookFails = false;
    await pg.query("update public.webhook_deliveries set next_attempt_at = now() where contract_id = $1", [c.contractId]);
    const r = await deliverPendingWebhooks(d);
    expect(r.succeeded).toBeGreaterThanOrEqual(1);
    const done = await pg.query("select * from public.webhook_deliveries where contract_id = $1", [c.contractId]);
    expect(done.rows[0].delivered_at).not.toBeNull();
    // 取消後に同じ依頼元から作り直せる（取消済みは再利用しない）
    const again = await createIntegrationContract(d, {
      templateId,
      externalRef: "deal_456",
      signer: { name: "伊藤" },
      values: { 氏名: "伊藤", 金額: "1000" },
    });
    expect(again.created).toBe(true);
    expect(again.contractId).not.toBe(c.contractId);
  });

  it("連携元の値の検証エラーはそのまま返す", async () => {
    await expect(createIntegrationContract(d, { templateId, externalRef: "x", signer: { name: "a" }, values: {} })).rejects.toMatchObject({
      code: "invalid_values",
    });
    await expect(createIntegrationContract(d, { templateId, signer: { name: "a" } })).rejects.toMatchObject({ status: 400 });
  });

  it("anon・authenticated は通知のキューを読めない", async () => {
    await pg.query("begin");
    await pg.query("set local role anon");
    await expect(pg.query("select * from public.webhook_deliveries")).rejects.toThrow(/permission denied/);
    await pg.query("rollback");
  });
});
