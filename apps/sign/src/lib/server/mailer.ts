import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
}

export interface MailResult {
  id: string | null;
  /** 実際には送らず記録だけした（開発用） */
  logged?: boolean;
}

export interface Mailer {
  send(msg: MailMessage): Promise<MailResult>;
}

export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(msg: MailMessage): Promise<MailResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        reply_to: msg.replyTo,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString("base64"),
          content_type: a.contentType,
        })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`メール送信に失敗しました（HTTP ${res.status}）: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? null };
  }
}

/** 開発用：送信せず、ファイル（.data/outbox.jsonl）とコンソールに記録する */
export class OutboxMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly file?: string) {}

  async send(msg: MailMessage): Promise<MailResult> {
    this.sent.push(msg);
    if (this.file) {
      await mkdir(path.dirname(this.file), { recursive: true });
      const record = {
        at: new Date().toISOString(),
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, size: a.content.length })),
      };
      await appendFile(this.file, `${JSON.stringify(record)}\n`);
    }
    if (process.env.NODE_ENV !== "test") {
      console.info(`[mail] to=${msg.to} subject=${msg.subject}`);
    }
    return { id: null, logged: true };
  }
}
