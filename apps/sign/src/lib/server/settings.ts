import "server-only";
import { audit, type ClientInfo } from "./audit";
import type { Db } from "./db";
import { type Actor, AppError, type SettingsRow } from "./types";

export async function getSettings(db: Db): Promise<SettingsRow> {
  const s = await db.one<SettingsRow>("select * from public.settings where id");
  if (!s) throw new Error("settings row missing");
  return s;
}

const EDITABLE: Record<keyof Omit<SettingsRow, never>, "text" | "int" | "bool" | "num" | "nullable_text"> = {
  organization_name: "text",
  organization_representative: "text",
  admin_notify_email: "nullable_text",
  default_expiry_days: "int",
  reminder_after_send_days: "int",
  reminder_before_expiry_days: "int",
  auto_reminder_enabled: "bool",
  anonymize_after_days: "int",
  daily_hash_email_enabled: "bool",
  privacy_policy_url: "nullable_text",
  cost_email_yen: "num",
  cost_sms_yen: "num",
  cost_timestamp_yen: "num",
};

export async function updateSettings(db: Db, actor: Actor, input: Partial<Record<keyof SettingsRow, unknown>>, client?: ClientInfo) {
  if (actor.role !== "owner") throw new AppError("設定の変更はオーナーのみ可能です", "forbidden", 403);
  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(EDITABLE)) {
    if (!(key in input)) continue;
    const raw = input[key as keyof SettingsRow];
    let v: unknown;
    if (kind === "bool") v = raw === true || raw === "true" || raw === "on";
    else if (kind === "int") {
      v = Number(raw);
      if (!Number.isInteger(v)) throw new AppError(`${key} は整数で入力してください`);
    } else if (kind === "num") {
      v = Number(raw);
      if (!Number.isFinite(v)) throw new AppError(`${key} は数値で入力してください`);
    } else if (kind === "nullable_text") v = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    else {
      v = typeof raw === "string" ? raw.trim() : "";
      if (v === "") throw new AppError(`${key} を入力してください`);
    }
    params.push(v);
    sets.push(`${key} = $${params.length}`);
    changed[key] = v;
  }
  if (!sets.length) return getSettings(db);
  try {
    await db.query(`update public.settings set ${sets.join(", ")} where id`, params);
  } catch (e) {
    throw new AppError(`設定値が範囲外です: ${e instanceof Error ? e.message : String(e)}`);
  }
  await audit(db, { actorType: "admin", actorId: actor.id, eventType: "settings.updated", payload: changed, client });
  return getSettings(db);
}
