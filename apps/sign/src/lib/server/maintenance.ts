import "server-only";
import { jstDateString } from "../format";
import { audit } from "./audit";
import { sendReminder } from "./contracts";
import type { Deps } from "./deps";
import { sendEmail } from "./notify";
import { getSettings } from "./settings";
import { processTimestampJobs } from "./signing";

/** 期限を過ぎた未署名の契約を「期限切れ」にする */
export async function markExpired(d: Deps): Promise<number> {
  const rows = await d.db.query<{ id: string }>(
    `update public.contracts set status = 'expired'
     where status in ('draft', 'sent', 'viewed') and expires_at < now() returning id`,
  );
  for (const r of rows) {
    await audit(d.db, { contractId: r.id, actorType: "system", eventType: "contract.expired" });
  }
  return rows.length;
}

/** 自動リマインド：送付からN日後と、期限のN日前（それぞれ1回） */
export async function sendDueReminders(d: Deps): Promise<number> {
  const s = await getSettings(d.db);
  if (!s.auto_reminder_enabled) return 0;
  const due = await d.db.query<{ id: string }>(
    `select c.id from public.contracts c
     join public.contract_parties p on p.contract_id = c.id
     where c.status in ('sent', 'viewed') and c.expires_at > now() and p.email is not null
       and 'email' = any(p.delivery_channels)
       and (
         (p.last_reminded_at is null and c.sent_at + make_interval(days => $1) <= now())
         or ((p.last_reminded_at is null or p.last_reminded_at < c.expires_at - make_interval(days => $2))
             and c.expires_at - make_interval(days => $2) <= now())
       )`,
    [s.reminder_after_send_days, s.reminder_before_expiry_days],
  );
  let n = 0;
  for (const c of due) {
    try {
      await sendReminder(d, null, c.id);
      n++;
    } catch (e) {
      console.warn("[cron] reminder failed", c.id, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** 署名されなかった契約の個人情報を、設定した期間の経過後に匿名化する（署名済みは対象外） */
export async function anonymizeStale(d: Deps): Promise<number> {
  const s = await getSettings(d.db);
  const targets = await d.db.query<{ id: string }>(
    `select c.id from public.contracts c
     where c.status in ('expired', 'canceled') and c.anonymized_at is null
       and coalesce(c.canceled_at, c.expires_at) < now() - make_interval(days => $1)`,
    [s.anonymize_after_days],
  );
  for (const t of targets) {
    await d.db.tx(async (tx) => {
      await tx.query(
        `update public.contract_parties set name = '（匿名化済み）', email = null, phone = null, company = null,
           verified_email = null, signature_image = null, signed_name = null where contract_id = $1`,
        [t.id],
      );
      await tx.query("update public.contract_values set value = '' where contract_id = $1", [t.id]);
      await tx.query(
        `update public.otp_challenges set destination = '（匿名化済み）'
         where contract_party_id in (select id from public.contract_parties where contract_id = $1)`,
        [t.id],
      );
      await tx.query(
        `update public.contracts c set anonymized_at = now(), counterparty_name = null,
           title = (select tt.name from public.template_versions v join public.templates tt on tt.id = v.template_id where v.id = c.template_version_id) || '（匿名化済み）'
         where id = $1`,
        [t.id],
      );
      await audit(tx, { contractId: t.id, actorType: "system", eventType: "data.anonymized", payload: { after_days: s.anonymize_after_days } });
    });
  }
  // どの契約にも実データが残っていない連絡先は匿名化する
  await d.db.query(
    `update public.contacts ct set name = '（匿名化済み）', email = null, phone = null, company = null, note = '', tags = '{}',
       line_user_id = null, anonymized_at = now()
     where ct.anonymized_at is null
       and exists (select 1 from public.contract_parties p where p.contact_id = ct.id)
       and not exists (
         select 1 from public.contract_parties p join public.contracts c on c.id = p.contract_id
         where p.contact_id = ct.id and c.anonymized_at is null)`,
  );
  return targets.length;
}

/** 1日1回、監査ログの最新ハッシュを管理者宛てにメールで送る */
export async function sendDailyDigest(d: Deps): Promise<boolean> {
  const s = await getSettings(d.db);
  if (!s.daily_hash_email_enabled || !s.admin_notify_email) return false;
  const today = jstDateString(d.now());
  const already = await d.db.one(
    `select 1 from public.audit_events where event_type = 'audit.daily_digest' and payload->>'date' = $1 limit 1`,
    [today],
  );
  if (already) return false;
  const last = await d.db.one<{ seq: string; hash: string; created_at: string }>(
    "select seq, hash, created_at from public.audit_events order by seq desc limit 1",
  );
  if (!last) return false;
  const ok = await sendEmail(d, s, {
    contractId: null,
    type: "daily_digest",
    to: s.admin_notify_email,
    subject: `【監査ログの控え】${today}`,
    text: [
      `${today} 時点の監査ログの最新ハッシュです。このメールは外部に残す控えとして保管してください。`,
      "",
      `記録番号：#${last.seq}`,
      `記録日時：${last.created_at}（UTC）`,
      `ハッシュ：${last.hash}`,
      "",
      "管理画面の「監査ログ」→「整合性をチェック」で表示される最新ハッシュと照合できます。",
    ].join("\n"),
  });
  if (ok) {
    await audit(d.db, { actorType: "system", eventType: "audit.daily_digest", payload: { date: today, seq: Number(last.seq), hash: last.hash } });
  }
  return ok;
}

export async function runMaintenance(d: Deps) {
  const timestamps = await processTimestampJobs(d);
  const expired = await markExpired(d);
  const reminders = await sendDueReminders(d);
  const anonymized = await anonymizeStale(d);
  const digest = await sendDailyDigest(d);
  return { timestamps, expired, reminders, anonymized, digest };
}
