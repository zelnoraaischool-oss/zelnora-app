import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createContract, getContractDetail } from "@/lib/server/contracts";
import { anonymizeStale, markExpired, sendDailyDigest, sendDueReminders } from "@/lib/server/maintenance";
import { seedCourseTemplate } from "@/lib/server/seed";
import type { Actor } from "@/lib/server/types";
import { connect, createAdmin } from "./helpers";
import { testDeps } from "./deps";

let pg: Client;
let owner: Actor;
let templateId: string;
const { d, mailer } = testDeps();

const values = {
  受講者氏名: "保守 太郎",
  プラン名: "マンツーマン講座",
  受講料: "30000",
  "受講期間（月）": "3",
  受講開始日: "2026-10-01",
  支払方法: "銀行振込",
  支払期限: "2026-10-10",
  契約日: "2026-09-30",
};

beforeAll(async () => {
  pg = await connect();
  const a = await createAdmin(pg, "owner");
  owner = { id: a.id, email: a.email, role: "owner" };
  templateId = (await seedCourseTemplate(d.db, owner)).templateId;
});
afterAll(async () => {
  await pg.end();
});

describe("初期テンプレート", () => {
  it("受講契約書が公開済みテンプレートとして登録され、2回目は重複しない", async () => {
    const again = await seedCourseTemplate(d.db, owner);
    expect(again.created).toBe(false);
    expect(again.templateId).toBe(templateId);
    const r = await pg.query("select t.name, v.published_at, v.body_hash from public.templates t join public.template_versions v on v.id = t.current_version_id where t.id = $1", [templateId]);
    expect(r.rows[0].name).toBe("AIエンジニア育成マンツーマン講座 受講契約書");
    expect(r.rows[0].body_hash).toMatch(/^[0-9a-f]{64}$/);
    const clauses = await pg.query("select count(*)::int as n from public.clauses");
    expect(clauses.rows[0].n).toBeGreaterThanOrEqual(4);
  });
});

describe("定期実行", () => {
  it("送付から3日後に自動リマインドを1回だけ送る", async () => {
    const c = await createContract(d, owner, { templateId, signer: { name: "保守 太郎", email: "remind@example.com" }, values, channels: ["email"] });
    expect(await sendDueReminders(d)).toBe(0);
    await pg.query("update public.contracts set sent_at = now() - interval '3 days 1 minute' where id = $1", [c.contractId]);
    expect(await sendDueReminders(d)).toBe(1);
    expect(mailer.sent.at(-1)?.subject).toContain("リマインド");
    expect(await sendDueReminders(d)).toBe(0);
    // 期限の1日前にもう1回（最初のリマインドは数日前に送ったことにする）
    await pg.query("update public.contract_parties set last_reminded_at = now() - interval '8 days' where contract_id = $1", [c.contractId]);
    await pg.query("update public.contracts set expires_at = now() + interval '20 hours' where id = $1", [c.contractId]);
    await pg.query("update public.access_tokens set expires_at = now() + interval '20 hours' where contract_party_id = (select id from public.contract_parties where contract_id = $1)", [c.contractId]);
    expect(await sendDueReminders(d)).toBe(1);
    expect(await sendDueReminders(d)).toBe(0);
  });

  it("期限切れの契約を「期限切れ」にし、一定期間後に個人情報を匿名化する（署名済みは対象外）", async () => {
    const c = await createContract(d, owner, { templateId, signer: { name: "匿名 花子", email: "anon@example.com", phone: "090-1111-2222" }, values: { ...values, 受講者氏名: "匿名 花子" }, channels: ["url"] });
    await pg.query("update public.contracts set expires_at = now() - interval '400 days' where id = $1", [c.contractId]);
    expect(await markExpired(d)).toBeGreaterThanOrEqual(1);
    expect(await anonymizeStale(d)).toBeGreaterThanOrEqual(1);
    const detail = await getContractDetail(d.db, c.contractId);
    expect(detail.party.name).toBe("（匿名化済み）");
    expect(detail.party.email).toBeNull();
    expect(detail.values.every((v) => v.value === "")).toBe(true);
    expect(detail.contract.title).toContain("匿名化済み");
    const contact = await pg.query("select name, email from public.contacts where id = $1", [detail.party.contact_id]);
    expect(contact.rows[0]).toEqual({ name: "（匿名化済み）", email: null });
    const chain = await pg.query("select * from public.verify_audit_chain()");
    expect(chain.rows[0].ok).toBe(true);
  });

  it("日次ハッシュを1日1回だけ送る", async () => {
    await pg.query("update public.settings set daily_hash_email_enabled = true, admin_notify_email = 'owner@example.com'");
    expect(await sendDailyDigest(d)).toBe(true);
    expect(mailer.sent.at(-1)?.text).toMatch(/ハッシュ：[0-9a-f]{64}/);
    expect(await sendDailyDigest(d)).toBe(false);
  });
});
