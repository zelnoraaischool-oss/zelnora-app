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

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied|immutable|not allowed/i);
}

describe("受け入れ基準4: 署名済みの契約・確定版PDF・監査ログは管理者でも更新・削除できない", () => {
  it("管理者（authenticated・aal2）はAPIから契約・PDF・監査ログを変更できない", async () => {
    const admin = await createAdmin(c, "owner");
    const f = await createContractFixture(c);
    const { documentId } = await signFixture(c, f.partyId);

    const attempts: Array<[string, unknown[]]> = [
      ["update public.contracts set title = '改ざん' where id = $1", [f.contractId]],
      ["delete from public.contracts where id = $1", [f.contractId]],
      ["update public.contract_values set value = '改ざん' where contract_id = $1", [f.contractId]],
      ["delete from public.contract_values where contract_id = $1", [f.contractId]],
      ["update public.contract_parties set signed_name = '改ざん' where id = $1", [f.partyId]],
      ["update public.documents set sha256 = repeat('0', 64) where id = $1", [documentId]],
      ["delete from public.documents where id = $1", [documentId]],
      ["update public.audit_events set payload = '{}' where contract_id = $1", [f.contractId]],
      ["delete from public.audit_events where contract_id = $1", [f.contractId]],
      [
        "insert into public.audit_events (actor_type, event_type, hash, seq, created_at) values ('admin', 'fake', 'x', 999999, now())",
        [],
      ],
    ];
    for (const [sql, params] of attempts) {
      await expectDenied(asRole(c, "authenticated", admin.claims, () => c.query(sql, params)));
    }
  });

  it("service_role（サーバー鍵）でも署名済みの契約・PDF・監査ログは変更できない", async () => {
    const f = await createContractFixture(c);
    const { documentId } = await signFixture(c, f.partyId);

    const attempts: Array<[string, unknown[]]> = [
      ["update public.contracts set title = '改ざん' where id = $1", [f.contractId]],
      ["update public.contracts set amount = 1 where id = $1", [f.contractId]],
      ["delete from public.contracts where id = $1", [f.contractId]],
      ["update public.contract_values set value = '改ざん' where contract_id = $1", [f.contractId]],
      [
        "insert into public.contract_values (contract_id, variable_key, value, entered_by) values ($1, '追加', 'x', 'admin')",
        [f.contractId],
      ],
      ["delete from public.contract_parties where id = $1", [f.partyId]],
      ["update public.documents set storage_path = 'x' where id = $1", [documentId]],
      ["delete from public.documents where id = $1", [documentId]],
      ["update public.audit_events set ip = '0.0.0.0' where contract_id = $1", [f.contractId]],
      ["delete from public.audit_events where contract_id = $1", [f.contractId]],
      ["truncate public.audit_events", []],
    ];
    for (const [sql, params] of attempts) {
      await expectDenied(asRole(c, "service_role", {}, () => c.query(sql, params)));
    }
    // postgres（DB所有者）でもトリガーにより拒否される
    await expectDenied(c.query("update public.documents set sha256 = repeat('0', 64) where id = $1", [documentId]));
    await expectDenied(c.query("update public.contracts set title = 'x' where id = $1", [f.contractId]));
  });

  it("確定版PDFのストレージオブジェクトは上書き・削除できない", async () => {
    await c.query("insert into storage.objects (bucket_id, name) values ('documents', 'contracts/x/final.pdf')");
    await expectDenied(
      asRole(c, "service_role", {}, () =>
        c.query("delete from storage.objects where bucket_id = 'documents' and name = 'contracts/x/final.pdf'"),
      ),
    );
    await expectDenied(
      asRole(c, "service_role", {}, () =>
        c.query("update storage.objects set name = 'y' where bucket_id = 'documents' and name = 'contracts/x/final.pdf'"),
      ),
    );
  });

  it("タイムスタンプは追記できるが、変更・削除はできない", async () => {
    const f = await createContractFixture(c);
    const { documentId, sha256 } = await signFixture(c, f.partyId);
    const r = await asRole(c, "service_role", {}, () =>
      c.query(
        `insert into public.document_timestamps (document_id, contract_id, target, hashed_message, tsa_url, tsa_token, tsa_time)
         values ($1, $2, 'pdf', $3, 'https://tsa.example', 'MIIB', now()) returning id`,
        [documentId, f.contractId, sha256],
      ),
    );
    const id = r.rows[0].id;
    await expectDenied(
      asRole(c, "service_role", {}, () =>
        c.query("update public.document_timestamps set tsa_time = now() - interval '1 day' where id = $1", [id]),
      ),
    );
    await expectDenied(
      asRole(c, "service_role", {}, () => c.query("delete from public.document_timestamps where id = $1", [id])),
    );
  });

  it("署名前の契約は取消できるが、取消後に再開はできない", async () => {
    const f = await createContractFixture(c);
    await asRole(c, "service_role", {}, () =>
      c.query("update public.contracts set status = 'canceled', canceled_at = now(), cancel_reason = '申込撤回' where id = $1", [
        f.contractId,
      ]),
    );
    await expectDenied(
      asRole(c, "service_role", {}, () =>
        c.query("update public.contracts set status = 'sent' where id = $1", [f.contractId]),
      ),
    );
    // 取消理由なしの取消は不可
    const g = await createContractFixture(c);
    await expect(
      c.query("update public.contracts set status = 'canceled', canceled_at = now() where id = $1", [g.contractId]),
    ).rejects.toThrow(/check constraint/);
  });

  it("署名の確定は1回だけ。取消済み・期限切れの契約には署名できない", async () => {
    const f = await createContractFixture(c);
    await signFixture(c, f.partyId);
    await expect(signFixture(c, f.partyId)).rejects.toThrow();

    const g = await createContractFixture(c);
    await c.query(
      "update public.contracts set status = 'canceled', canceled_at = now(), cancel_reason = 'テスト' where id = $1",
      [g.contractId],
    );
    await expect(signFixture(c, g.partyId)).rejects.toThrow(/canceled/);

    const h = await createContractFixture(c);
    await c.query("update public.contracts set expires_at = now() - interval '1 minute' where id = $1", [h.contractId]);
    await expect(signFixture(c, h.partyId)).rejects.toThrow(/expired/);
  });

  it("本人確認・全文閲覧が済んでいない署名者は署名を確定できない", async () => {
    const f = await createContractFixture(c);
    await expect(
      c.query(
        `select public.finalize_signature($1, '山田太郎', null, '{}', now(), null, null, 'p', repeat('b', 64), 1, 'h')`,
        [f.partyId],
      ),
    ).rejects.toThrow(/not verified/);
  });
});

describe("受け入れ基準6: 公開済みテンプレートのバージョンは編集できない", () => {
  it("公開済みバージョンの更新・削除は拒否され、本文ハッシュが確定する", async () => {
    const f = await createContractFixture(c);
    expect(f.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    await expectDenied(
      asRole(c, "service_role", {}, () =>
        c.query(`update public.template_versions set body = '{"type":"doc"}' where id = $1`, [f.versionId]),
      ),
    );
    await expectDenied(
      asRole(c, "service_role", {}, () => c.query("delete from public.template_versions where id = $1", [f.versionId])),
    );
  });

  it("下書きバージョンからは契約を作成できず、本文ハッシュの不一致も拒否される", async () => {
    const t = await c.query("insert into public.templates (name) values ('下書きのみ') returning id");
    const v = await c.query(
      "insert into public.template_versions (template_id, version_no) values ($1, 1) returning id, body_hash",
      [t.rows[0].id],
    );
    expect(v.rows[0].body_hash).toBeNull();
    await expect(
      c.query(
        `insert into public.contracts (template_version_id, template_body_hash, title, expires_at)
         values ($1, 'x', 'x', now() + interval '1 day')`,
        [v.rows[0].id],
      ),
    ).rejects.toThrow(/published template version/);

    const f = await createContractFixture(c);
    await expect(
      c.query(
        `insert into public.contracts (template_version_id, template_body_hash, title, expires_at)
         values ($1, 'wrong', 'x', now() + interval '1 day')`,
        [f.versionId],
      ),
    ).rejects.toThrow(/hash mismatch/);
  });

  it("下書きはテンプレートごとに1つまで", async () => {
    const t = await c.query("insert into public.templates (name) values ('重複下書き') returning id");
    await c.query("insert into public.template_versions (template_id, version_no) values ($1, 1)", [t.rows[0].id]);
    await expect(
      c.query("insert into public.template_versions (template_id, version_no) values ($1, 2)", [t.rows[0].id]),
    ).rejects.toThrow(/duplicate key/);
  });
});
