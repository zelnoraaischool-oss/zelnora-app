import "server-only";
import type { Db } from "./db";

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface AuditInput {
  contractId?: string | null;
  actorType: "admin" | "signer" | "system" | "public";
  actorId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  client?: ClientInfo | null;
}

/** 監査ログを追記する（ハッシュチェーンはDBのトリガーが計算する） */
export async function audit(db: Db, e: AuditInput): Promise<void> {
  await db.query(
    `insert into public.audit_events (contract_id, actor_type, actor_id, event_type, ip, user_agent, payload)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.contractId ?? null,
      e.actorType,
      e.actorId ?? null,
      e.eventType,
      e.client?.ip ?? null,
      e.client?.userAgent?.slice(0, 500) ?? null,
      JSON.stringify(e.payload ?? {}),
    ],
  );
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
}
