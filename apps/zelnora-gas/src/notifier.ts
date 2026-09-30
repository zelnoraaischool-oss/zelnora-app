// 通知：Slack・Google Chat のWebhookと、メール（任意）
import type { Notification, Notifier, Settings, User } from "@zelnora/core";

export class GasNotifier implements Notifier {
  private queue: Notification[] = [];

  send(n: Notification): void {
    if (n.to.length || n.kind) this.queue.push(n);
  }

  /** リクエストの最後にまとめて送る（失敗しても処理は止めない） */
  deliver(settings: Settings | null, users: User[], appUrl: string): void {
    const s = settings?.notifications;
    if (!s || !this.queue.length) return;
    const nameOf = (email: string) => users.find((u) => u.email === email)?.name ?? email;
    for (const n of this.queue) {
      const text = `*${n.title}*\n${n.body}${n.to.length ? `\n宛先：${n.to.map(nameOf).join("、")}` : ""}${appUrl ? `\n${appUrl}` : ""}`;
      for (const url of [s.slackWebhook, s.googleChatWebhook].filter(Boolean)) {
        try {
          UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify({ text }), muteHttpExceptions: true });
        } catch (e) {
          console.warn("notify webhook failed", e);
        }
      }
      if (s.email) {
        for (const to of new Set(n.to)) {
          try {
            MailApp.sendEmail({ to, subject: `[Zelnora] ${n.title}`, body: `${n.body}\n\n${appUrl}` });
          } catch (e) {
            console.warn("notify mail failed", e);
          }
        }
      }
    }
    this.queue = [];
  }
}
