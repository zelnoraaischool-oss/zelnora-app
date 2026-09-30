import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asRole, connect, createAdmin, createContractFixture } from "./helpers";

let c: Client;
beforeAll(async () => {
  c = await connect();
});
afterAll(async () => {
  await c.end();
});

async function insertEvent(contractId: string | null, type: string, payload: object = {}) {
  return asRole(c, "service_role", {}, () =>
    c.query(
      `insert into public.audit_events (contract_id, actor_type, actor_id, event_type, ip, user_agent, payload)
       values ($1, 'system', null, $2, '198.51.100.7', 'ua', $3) returning seq, hash, prev_hash`,
      [contractId, type, JSON.stringify(payload)],
    ),
  );
}

async function verify() {
  const r = await c.query("select * from public.verify_audit_chain()");
  return r.rows[0] as { ok: boolean; checked: string; broken_seq: string | null; reason: string | null };
}

/** DB管理者がトリガーを外して直接書き換える（＝改ざんのシミュレーション） */
async function tamper(sql: string, params: unknown[]) {
  await c.query("begin");
  await c.query("alter table public.audit_events disable trigger audit_events_immutable");
  await c.query(sql, params);
  await c.query("alter table public.audit_events enable trigger audit_events_immutable");
  await c.query("commit");
}

describe("受け入れ基準5: 監査ログのハッシュチェーン", () => {
  it("追記するたびに直前のハッシュとつながる", async () => {
    const f = await createContractFixture(c);
    const a = await insertEvent(f.contractId, "contract.created", { by: "test" });
    const b = await insertEvent(f.contractId, "contract.sent", { channel: "email" });
    expect(b.rows[0].prev_hash).toBe(a.rows[0].hash);
    expect(Number(b.rows[0].seq)).toBe(Number(a.rows[0].seq) + 1);
    expect((await verify()).ok).toBe(true);
  });

  it("管理者は整合性チェックを実行できる", async () => {
    const admin = await createAdmin(c);
    const r = await asRole(c, "authenticated", admin.claims, () => c.query("select * from public.verify_audit_chain()"));
    expect(r.rows[0].ok).toBe(true);
    await expect(asRole(c, "anon", {}, () => c.query("select * from public.verify_audit_chain()"))).rejects.toThrow();
  });

  it("レコードを1件書き換えると検知される", async () => {
    const f = await createContractFixture(c);
    const e = await insertEvent(f.contractId, "contract.viewed", { note: "original" });
    await insertEvent(f.contractId, "contract.otp_verified");
    expect((await verify()).ok).toBe(true);

    await tamper(`update public.audit_events set payload = '{"note":"tampered"}' where seq = $1`, [e.rows[0].seq]);
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.broken_seq).toBe(String(e.rows[0].seq));
    expect(v.reason).toMatch(/改ざん/);

    // 元に戻すと整合する
    await tamper(`update public.audit_events set payload = '{"note":"original"}' where seq = $1`, [e.rows[0].seq]);
    expect((await verify()).ok).toBe(true);
  });

  it("ハッシュごと書き換えても次のレコードとのつながりで検知される", async () => {
    const e = await insertEvent(null, "admin.login", { a: 1 });
    await insertEvent(null, "admin.login", { a: 2 });
    const seq = e.rows[0].seq;
    await c.query("create temp table backup_forge as select * from public.audit_events where seq = $1", [seq]);
    await tamper(
      `update public.audit_events set payload = '{"a":999}',
         hash = public.audit_event_hash(prev_hash, seq, id, contract_id, actor_type, actor_id, event_type, ip, user_agent, '{"a":999}'::jsonb, created_at)
       where seq = $1`,
      [seq],
    );
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(Number(v.broken_seq)).toBe(Number(seq) + 1);
    await tamper(
      `update public.audit_events a set payload = b.payload, hash = b.hash from backup_forge b where a.seq = b.seq`,
      [],
    );
    expect((await verify()).ok).toBe(true);
  });

  it("途中のレコードを削除すると検知される", async () => {
    const e = await insertEvent(null, "x.deleted.target");
    await insertEvent(null, "x.after");
    const seq = e.rows[0].seq;
    await c.query("create temp table backup_del as select * from public.audit_events where seq = $1", [seq]);
    await tamper("delete from public.audit_events where seq = $1", [seq]);
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/途切れ/);
    // 復元（挿入トリガーを外して元の行を戻す）
    await c.query("begin");
    await c.query("alter table public.audit_events disable trigger audit_events_chain");
    await c.query("insert into public.audit_events select * from backup_del");
    await c.query("alter table public.audit_events enable trigger audit_events_chain");
    await c.query("commit");
    expect((await verify()).ok).toBe(true);
  });
});
