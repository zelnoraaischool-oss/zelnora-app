import "server-only";
import { fillText } from "../contract/document";
import { formatJst } from "../format";
import { audit, maskEmail } from "./audit";
import type { Deps } from "./deps";
import type { MailAttachment } from "./mailer";
import type { SettingsRow } from "./types";

export interface SendEmailInput {
  contractId: string | null;
  partyId?: string | null;
  type: "invite" | "otp" | "reminder" | "completed" | "admin_completed" | "daily_digest" | "admin_notice";
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** メールを送り、通知履歴と監査ログに残す。送信に失敗しても例外にせず結果を返す */
export async function sendEmail(d: Deps, settings: SettingsRow, input: SendEmailInput): Promise<boolean> {
  let status: "sent" | "failed" | "logged" = "sent";
  let error: string | null = null;
  let providerId: string | null = null;
  try {
    const r = await d.mailer.send({ to: input.to, subject: input.subject, text: input.text, attachments: input.attachments });
    providerId = r.id;
    if (r.logged) status = "logged";
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.message : String(e);
  }
  await d.db.query(
    `insert into public.notifications (contract_id, contract_party_id, channel, type, recipient, status, provider_message_id, cost_yen, error)
     values ($1, $2, 'email', $3, $4, $5, $6, $7, $8)`,
    [
      input.contractId,
      input.partyId ?? null,
      input.type,
      maskEmail(input.to),
      status,
      providerId,
      status === "failed" ? 0 : settings.cost_email_yen,
      error,
    ],
  );
  if (input.type !== "otp") {
    await audit(d.db, {
      contractId: input.contractId,
      actorType: "system",
      eventType: status === "failed" ? "notification.failed" : "notification.sent",
      payload: { channel: "email", type: input.type, to: maskEmail(input.to), error },
    });
  }
  return status !== "failed";
}

function footer(settings: SettingsRow): string {
  return [
    "",
    "――――――――――――――――",
    `${settings.organization_name}`,
    "このメールは送信専用です。お心当たりのない場合は破棄してください。",
  ].join("\n");
}

export function inviteMessage(
  settings: SettingsRow,
  v: { email_subject: string; email_body: string },
  ctx: { title: string; signerName: string; url: string; expiresAt: string; values: Record<string, string> },
) {
  const resolve = (k: string) =>
    ({
      契約名: ctx.title,
      署名者氏名: ctx.signerName,
      署名URL: ctx.url,
      有効期限: formatJst(ctx.expiresAt),
      発注者名: settings.organization_name,
    })[k] ?? ctx.values[k];
  const body =
    v.email_body.trim() !== ""
      ? fillText(v.email_body, resolve)
      : [
          `${ctx.signerName} 様`,
          "",
          `${settings.organization_name}です。`,
          `「${ctx.title}」をお送りします。下記のURLから内容をご確認のうえ、ご署名をお願いいたします。`,
          "",
          "{{署名URL}}",
          "",
          `有効期限：${formatJst(ctx.expiresAt)}（日本時間）`,
          "ご本人確認のため、URLを開いたあとにこのメールアドレスへ確認コードをお送りします。",
        ].join("\n");
  const text = fillText(body, resolve);
  return {
    subject: fillText(v.email_subject, resolve),
    // 本文に署名URLが含まれていなければ末尾に追加する
    text: (text.includes(ctx.url) ? text : `${text}\n\n署名URL：${ctx.url}`) + footer(settings),
  };
}

export function reminderMessage(settings: SettingsRow, ctx: { title: string; signerName: string; url: string; expiresAt: string }) {
  return {
    subject: `【リマインド】${ctx.title} のご署名のお願い`,
    text:
      [
        `${ctx.signerName} 様`,
        "",
        `${settings.organization_name}です。`,
        `先日お送りした「${ctx.title}」のご署名がまだ完了していません。`,
        "お手数ですが、下記のURLからご確認をお願いいたします。",
        "",
        ctx.url,
        "",
        `有効期限：${formatJst(ctx.expiresAt)}（日本時間）`,
      ].join("\n") + footer(settings),
  };
}

export function otpMessage(settings: SettingsRow, ctx: { title: string; code: string }) {
  return {
    subject: `【確認コード】${ctx.code}（${settings.organization_name}）`,
    text:
      [
        `「${ctx.title}」のご本人確認のための確認コードです。`,
        "",
        `確認コード：${ctx.code}`,
        "",
        "有効期限は10分です。このコードを他人に教えないでください。",
        "お心当たりのない場合は、このメールを破棄してください。",
      ].join("\n") + footer(settings),
  };
}

export function completedMessage(
  settings: SettingsRow,
  ctx: { title: string; signerName: string; signedAt: string; sha256: string; verifyUrl: string; viewUrl?: string },
) {
  return {
    subject: `【締結完了】${ctx.title}`,
    text:
      [
        `${ctx.signerName} 様`,
        "",
        `「${ctx.title}」の締結が完了しました。`,
        "確定版の契約書（合意締結証明書付き）を添付します。大切に保管してください。",
        "",
        `締結日時：${formatJst(ctx.signedAt, { seconds: true })}（日本時間）`,
        `PDFのハッシュ値（SHA-256）：${ctx.sha256}`,
        "",
        "契約書が改ざんされていないことは、次のページで確認できます。",
        ctx.verifyUrl,
      ].join("\n") + footer(settings),
  };
}

export function adminCompletedMessage(
  settings: SettingsRow,
  ctx: { title: string; signerName: string; signedAt: string; sha256: string; adminUrl: string; timestamped: boolean },
) {
  return {
    subject: `【署名完了】${ctx.title}（${ctx.signerName} 様）`,
    text: [
      `${ctx.signerName} 様が「${ctx.title}」に署名しました。`,
      "",
      `締結日時：${formatJst(ctx.signedAt, { seconds: true })}（日本時間）`,
      `PDFのハッシュ値：${ctx.sha256}`,
      ctx.timestamped ? "タイムスタンプ：付与済み" : "タイムスタンプ：未付与（自動で再試行します）",
      "",
      `管理画面：${ctx.adminUrl}`,
    ].join("\n"),
  };
}
