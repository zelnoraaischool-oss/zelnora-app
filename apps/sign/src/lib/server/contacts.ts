import "server-only";
import { audit, type ClientInfo } from "./audit";
import type { Db } from "./db";
import { type Actor, AppError, type ContactRow } from "./types";

export interface ContactInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  tags?: string[];
  note?: string;
}

function clean(input: ContactInput) {
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name) throw new AppError("氏名を入力してください");
  const email = input.email?.normalize("NFKC").trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("メールアドレスの形式が正しくありません");
  const phone = input.phone?.normalize("NFKC").replace(/[^\d+-]/g, "") || null;
  return {
    name,
    email,
    phone,
    company: input.company?.trim() || null,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    note: input.note?.trim() ?? "",
  };
}

export async function searchContacts(db: Db, q: string, limit = 20) {
  const like = `%${q.trim()}%`;
  return db.query<ContactRow>(
    `select * from public.contacts
     where anonymized_at is null and ($1 = '%%' or name ilike $1 or email ilike $1 or company ilike $1 or phone ilike $1
       or array_to_string(tags, ' ') ilike $1)
     order by updated_at desc limit $2`,
    [like, limit],
  );
}

export async function getContact(db: Db, id: string) {
  return db.one<ContactRow>("select * from public.contacts where id = $1", [id]);
}

/** メールアドレスで既存の連絡先を探し、あれば更新、なければ作成する */
export async function upsertContact(db: Db, actor: Actor, input: ContactInput & { id?: string }, client?: ClientInfo) {
  const c = clean(input);
  let existing: ContactRow | null = null;
  if (input.id) existing = await db.one<ContactRow>("select * from public.contacts where id = $1", [input.id]);
  if (!existing && c.email) {
    existing = await db.one<ContactRow>("select * from public.contacts where lower(email) = $1", [c.email]);
  }
  if (existing) {
    const row = await db.one<ContactRow>(
      `update public.contacts set name = $2, email = coalesce($3, email), phone = coalesce($4, phone),
         company = coalesce($5, company),
         tags = case when cardinality($6::text[]) > 0 then $6::text[] else tags end,
         note = case when $7 <> '' then $7 else note end
       where id = $1 returning *`,
      [existing.id, c.name, c.email, c.phone, c.company, c.tags, c.note],
    );
    await audit(db, {
      actorType: "admin",
      actorId: actor.id,
      eventType: "contact.updated",
      payload: { contact_id: existing.id },
      client,
    });
    return row!;
  }
  const row = await db.one<ContactRow>(
    `insert into public.contacts (name, email, phone, company, tags, note) values ($1, $2, $3, $4, $5, $6) returning *`,
    [c.name, c.email, c.phone, c.company, c.tags, c.note],
  );
  await audit(db, { actorType: "admin", actorId: actor.id, eventType: "contact.created", payload: { contact_id: row!.id }, client });
  return row!;
}

export async function listContacts(db: Db, q = "") {
  const like = `%${q.trim()}%`;
  return db.query<ContactRow & { contract_count: string; signed_count: string }>(
    `select c.*, (select count(*) from public.contract_parties p where p.contact_id = c.id) as contract_count,
       (select count(*) from public.contract_parties p where p.contact_id = c.id and p.status = 'signed') as signed_count
     from public.contacts c
     where c.anonymized_at is null and ($1 = '%%' or c.name ilike $1 or c.email ilike $1 or c.company ilike $1
       or array_to_string(c.tags, ' ') ilike $1)
     order by c.updated_at desc limit 200`,
    [like],
  );
}
