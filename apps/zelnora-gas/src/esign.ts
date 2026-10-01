// 電子契約システム（apps/sign の連携API）への窓口と、署名完了などの通知の検証
import type { EsignCreateRequest, EsignGateway, EsignRemoteStatus, EsignTemplateInfo } from "@zelnora/core";
import { prop } from "./gas-env";

/** 連携APIの呼び出し。APIキーはスクリプトプロパティ ESIGN_API_KEY に置く（設定シートには置かない） */
export class UrlFetchEsignGateway implements EsignGateway {
  constructor(
    private readonly baseUrl: () => string,
    private readonly apiKey: string,
  ) {}

  private call<T>(method: "get" | "post", path: string, body?: unknown): T {
    const base = this.baseUrl().replace(/\/+$/, "");
    if (!base) throw new Error("電子契約システムのURLが設定されていません");
    const res = UrlFetchApp.fetch(`${base}${path}`, {
      method,
      contentType: "application/json",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      payload: body === undefined ? undefined : JSON.stringify(body),
      muteHttpExceptions: true,
      followRedirects: false,
    });
    let json: { ok?: boolean; data?: T; error?: string } = {};
    try {
      json = JSON.parse(res.getContentText()) as typeof json;
    } catch {
      throw new Error(`応答を読み取れません（HTTP ${res.getResponseCode()}）`);
    }
    if (!json.ok) throw new Error(json.error ?? `HTTP ${res.getResponseCode()}`);
    return json.data as T;
  }

  templates(): EsignTemplateInfo[] {
    return this.call<EsignTemplateInfo[]>("get", "/api/integration/templates");
  }

  create(req: EsignCreateRequest) {
    return this.call<EsignRemoteStatus & { created?: boolean; emailSent?: boolean }>("post", "/api/integration/contracts", req);
  }

  status(q: { contractId?: string; externalRef?: string }): EsignRemoteStatus {
    const qs = q.contractId ? `contractId=${encodeURIComponent(q.contractId)}` : `externalRef=${encodeURIComponent(q.externalRef ?? "")}`;
    return this.call<EsignRemoteStatus>("get", `/api/integration/contracts?${qs}`);
  }
}

export function esignGateway(baseUrl: () => string): EsignGateway | undefined {
  const key = prop("ESIGN_API_KEY");
  return key ? new UrlFetchEsignGateway(baseUrl, key) : undefined;
}

function hex(bytes: number[]): string {
  return bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface EsignWebhookBody {
  kind: "esign.webhook";
  payload: string;
  signature: string;
}

/**
 * 通知の検証：電子契約システムと共有した秘密値（ESIGN_WEBHOOK_SECRET）での HMAC-SHA256。
 * Apps Script の doPost ではヘッダーを読めないため、署名は本文に入れて送られてくる。
 */
export function verifyEsignWebhook(body: EsignWebhookBody, now = Date.now()): EsignRemoteStatus & { event: string } {
  const secret = prop("ESIGN_WEBHOOK_SECRET");
  if (!secret) throw new Error("ESIGN_WEBHOOK_SECRET が設定されていません");
  if (typeof body.payload !== "string" || typeof body.signature !== "string") throw new Error("通知の形式が正しくありません");
  const expected = hex(Utilities.computeHmacSha256Signature(body.payload, secret));
  if (!safeEqual(expected, body.signature.toLowerCase())) throw new Error("通知の署名が一致しません");
  const p = JSON.parse(body.payload) as EsignRemoteStatus & { event: string; sentAt?: string };
  // 古い通知の再送（リプレイ）は受け付けない。正規の再送は数時間以内に届く
  const sentAt = p.sentAt ? Date.parse(p.sentAt) : NaN;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > 3 * 86400_000) throw new Error("通知の送信時刻が古すぎます");
  return p;
}
