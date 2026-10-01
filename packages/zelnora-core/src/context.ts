import { type Clock, nowIso, systemClock } from "./dates";
import type { Store } from "./store";
import type { AuditEntry, User } from "./types";
import { newId } from "./util";

export interface Notification {
  kind: string;
  /** 宛先ユーザー（メールアドレス） */
  to: string[];
  title: string;
  body: string;
  link?: string;
  productId?: string | null;
}

export interface Notifier {
  send(n: Notification): void;
}

export class CollectingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  send(n: Notification): void {
    this.sent.push(n);
  }
}

/** 電子契約システムの契約の状態（連携APIの応答・通知の内容） */
export interface EsignRemoteStatus {
  contractId: string;
  externalRef: string | null;
  title?: string;
  status: string;
  signedAt: string | null;
  sha256?: string | null;
  url?: string | null;
  adminUrl?: string | null;
}

export interface EsignTemplateInfo {
  id: string;
  name: string;
  variables: { key: string; type: string; filledBy: "admin" | "signer"; required: boolean; options?: string[] }[];
}

export interface EsignCreateRequest {
  templateId: string;
  externalRef: string;
  signer: { name: string; email?: string | null; phone?: string | null; company?: string | null };
  values: Record<string, string>;
  title?: string;
  sendEmail: boolean;
  expiresInDays: number;
}

/** 電子契約システムへの窓口（Apps Script では UrlFetchApp、デモではブラウザ内の代わり） */
export interface EsignGateway {
  templates(): EsignTemplateInfo[];
  create(req: EsignCreateRequest): EsignRemoteStatus & { created?: boolean; emailSent?: boolean };
  status(q: { contractId?: string; externalRef?: string }): EsignRemoteStatus;
}

export interface Ctx {
  store: Store;
  clock: Clock;
  notifier: Notifier;
  /** 登録フォームの事前入力URLを作る（Apps Script では FormApp を使う） */
  prefillUrl?: (formId: string, values: { name?: string; email?: string }) => string | null;
  /** 電子契約システム（未設定なら連携しない） */
  esign?: EsignGateway;
}

export function createCtx(store: Store, opts: Partial<Omit<Ctx, "store">> = {}): Ctx {
  return { store, clock: opts.clock ?? systemClock, notifier: opts.notifier ?? new CollectingNotifier(), prefillUrl: opts.prefillUrl, esign: opts.esign };
}

/** 監査ログ（ZN-ROLE-04 の付け替え、統合、締めの解除などを残す） */
export function audit(ctx: Ctx, actor: Pick<User, "email"> | null, action: string, entity: string, entityId: string, detail: unknown = {}): void {
  const e: AuditEntry = {
    id: newId("au", ctx.clock),
    at: nowIso(ctx.clock),
    user: actor?.email ?? "system",
    action,
    entity,
    entityId,
    detail: JSON.stringify(detail),
  };
  ctx.store.put("audit", e);
}
