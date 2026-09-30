import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { inject } from "vitest";

export async function connect(): Promise<Client> {
  const c = new Client({ connectionString: inject("databaseUrl") });
  await c.connect();
  return c;
}

export type Role = "anon" | "authenticated" | "service_role";

/** 指定ロール（PostgREST相当）でSQLを実行する。自動でロールバックしない。 */
export async function asRole<T>(
  c: Client,
  role: Role,
  claims: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  await c.query("begin");
  try {
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role, ...claims })]);
    const r = await fn();
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

export async function createAdmin(c: Client, role: "owner" | "staff" = "owner") {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await c.query("insert into public.admins (id, email, role, mfa_enabled) values ($1, $2, $3, true)", [id, email, role]);
  return { id, email, claims: { sub: id, aal: "aal2" } };
}

/** 公開済みテンプレートと、署名待ちの契約・署名者を作成する（postgres権限で） */
export async function createContractFixture(c: Client) {
  const t = await c.query("insert into public.templates (name) values ('テスト契約') returning id");
  const templateId = t.rows[0].id as string;
  const v = await c.query(
    `insert into public.template_versions (template_id, version_no, body, variables)
     values ($1, 1, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}', '[]')
     returning id`,
    [templateId],
  );
  const versionId = v.rows[0].id as string;
  const pub = await c.query(
    "update public.template_versions set published_at = now() where id = $1 returning body_hash",
    [versionId],
  );
  const bodyHash = pub.rows[0].body_hash as string;
  const k = await c.query(
    `insert into public.contracts (template_version_id, template_body_hash, title, status, expires_at, amount, transaction_date, counterparty_name)
     values ($1, $2, 'テスト契約', 'sent', now() + interval '14 days', 30000, '2026-09-30', '山田太郎') returning id`,
    [versionId, bodyHash],
  );
  const contractId = k.rows[0].id as string;
  const p = await c.query(
    "insert into public.contract_parties (contract_id, name, email) values ($1, '山田太郎', 'taro@example.com') returning id",
    [contractId],
  );
  const partyId = p.rows[0].id as string;
  await c.query(
    "insert into public.contract_values (contract_id, variable_key, value, entered_by) values ($1, '受講者氏名', '山田太郎', 'admin')",
    [contractId],
  );
  return { templateId, versionId, bodyHash, contractId, partyId };
}

export async function signFixture(c: Client, partyId: string) {
  await c.query("update public.contract_parties set verified_at = now(), read_completed_at = now() where id = $1", [
    partyId,
  ]);
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "a");
  const r = await c.query(
    `select public.finalize_signature($1, '山田太郎', null, '{"all":true}', now(), '203.0.113.1', 'test-ua',
       $2, $3, 1234, 'contenthash') as doc_id`,
    [partyId, `contracts/${partyId}/final.pdf`, sha],
  );
  return { documentId: r.rows[0].doc_id as string, sha256: sha };
}
