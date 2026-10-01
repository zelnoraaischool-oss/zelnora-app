import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asRole, connect, createAdmin, createContractFixture, signFixture } from "./helpers";

let c: Client;
beforeAll(async () => {
  c = await connect();
});
afterAll(async () => {
  await c.end();
});

const TABLES = [
  "admins",
  "settings",
  "templates",
  "template_versions",
  "clauses",
  "contacts",
  "contracts",
  "contract_parties",
  "contract_values",
  "access_tokens",
  "otp_challenges",
  "documents",
  "document_timestamps",
  "timestamp_jobs",
  "audit_events",
  "notifications",
];

describe("RLS: すべてのテーブルが保護されている", () => {
  it("public スキーマの全テーブルでRLSが有効", async () => {
    const r = await c.query(
      "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity",
    );
    expect(r.rows).toEqual([]);
  });

  it("トークンなし（anon）では契約書・署名者・値を一切読めない", async () => {
    await createContractFixture(c);
    for (const t of TABLES) {
      await expect(asRole(c, "anon", {}, () => c.query(`select * from public.${t} limit 1`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("管理者でないログインユーザー、MFA未完了（aal1）の管理者には何も見えない", async () => {
    await createContractFixture(c);
    const admin = await createAdmin(c);
    const notAdmin = { sub: "00000000-0000-0000-0000-000000000001", aal: "aal2" };
    const aal1 = { sub: admin.id, aal: "aal1" };
    for (const claims of [notAdmin, aal1]) {
      const r = await asRole(c, "authenticated", claims, () => c.query("select id from public.contracts"));
      expect(r.rows).toHaveLength(0);
      const v = await asRole(c, "authenticated", claims, () => c.query("select id from public.contract_values"));
      expect(v.rows).toHaveLength(0);
    }
  });

  it("MFA済みの管理者は参照できるが、トークンとOTPは参照できない", async () => {
    const f = await createContractFixture(c);
    const admin = await createAdmin(c, "staff");
    const r = await asRole(c, "authenticated", admin.claims, () =>
      c.query("select id from public.contracts where id = $1", [f.contractId]),
    );
    expect(r.rows).toHaveLength(1);
    await expect(
      asRole(c, "authenticated", admin.claims, () => c.query("select * from public.access_tokens")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(c, "authenticated", admin.claims, () => c.query("select * from public.otp_challenges")),
    ).rejects.toThrow(/permission denied/);
  });

  it("管理者でもテーブルへ直接書き込めない（書き込みはサーバー経由のみ）", async () => {
    const admin = await createAdmin(c, "owner");
    await expect(
      asRole(c, "authenticated", admin.claims, () => c.query("insert into public.contacts (name) values ('x')")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(c, "authenticated", admin.claims, () => c.query("update public.settings set default_expiry_days = 1")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(c, "authenticated", admin.claims, () =>
        c.query("select public.finalize_signature(gen_random_uuid(), 'x', null, '{}', now(), null, null, 'p', repeat('c',64), 1, 'h')"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("検証ページ用の関数", () => {
  it("誰でもハッシュで照合でき、個人情報は返さない", async () => {
    const f = await createContractFixture(c);
    const { sha256 } = await signFixture(c, f.partyId);
    const r = await asRole(c, "anon", {}, () => c.query("select * from public.verify_document($1)", [sha256]));
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]).sort()).toEqual(["contract_id", "created_at", "kind", "signed_at", "title", "tsa_time"]);
    const none = await asRole(c, "anon", {}, () =>
      c.query("select * from public.verify_document($1)", ["f".repeat(64)]),
    );
    expect(none.rows).toHaveLength(0);
  });
});

describe("実効ステータス", () => {
  it("期限を過ぎた未署名の契約は expired と扱われる", async () => {
    const f = await createContractFixture(c);
    await c.query("update public.contracts set expires_at = now() - interval '1 second' where id = $1", [f.contractId]);
    const r = await c.query("select effective_status from public.contracts_view where id = $1", [f.contractId]);
    expect(r.rows[0].effective_status).toBe("expired");
  });
});
