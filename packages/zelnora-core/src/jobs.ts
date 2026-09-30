import type { Ctx } from "./context";
import { addDays, monthOf, today } from "./dates";
import { label } from "./dictionary";
import { retryFailedImports } from "./registration";
import { getSettings } from "./settings";
import type { Customer, Delivery, ProgressItem, User } from "./types";

/**
 * 毎日の自動処理（5.3 の「予定日を過ぎた」「終了日が来た」「月末」）。
 * Apps Script の時間主導型トリガーから呼ぶ。
 */
export function runDailyJobs(ctx: Ctx) {
  const t = today(ctx.clock);
  const s = getSettings(ctx);
  const users = ctx.store.all<User>("users").filter((u) => u.active);
  const managersOf = (productId: string) => users.filter((u) => u.role === "manager" && u.productIds.includes(productId)).map((u) => u.email);
  const customers = new Map(ctx.store.all<Customer>("customers").map((c) => [c.id, c.name]));
  const deliveries = ctx.store.all<Delivery>("deliveries").filter((d) => d.status === "active");
  const items = ctx.store.all<ProgressItem>("progress");

  // 進捗項目の予定日を過ぎた（前日が予定日のものだけ知らせ、毎日重複して送らない）
  const yesterday = addDays(t, -1);
  let overdue = 0;
  for (const d of deliveries) {
    const late = items.filter((i) => i.deliveryId === d.id && i.status === "planned" && i.dueDate === yesterday);
    if (!late.length) continue;
    overdue += late.length;
    const product = s.products.find((p) => p.id === d.productId);
    ctx.notifier.send({
      kind: "progress.overdue",
      to: [...new Set([d.owner, ...managersOf(d.productId)].filter((x): x is string => !!x))],
      title: `遅れ：${customers.get(d.customerId) ?? ""}（${late.map((i) => i.name).join("、")}）`,
      body: `${label("progressItem", product)}の予定日（${yesterday}）を過ぎました。`,
      productId: d.productId,
    });
  }

  // 提供の終了日が来た：修了の確認
  let ending = 0;
  for (const d of deliveries.filter((x) => x.endDate === t)) {
    ending++;
    const product = s.products.find((p) => p.id === d.productId);
    ctx.notifier.send({
      kind: "delivery.ending",
      to: [d.owner].filter((x): x is string => !!x),
      title: `${label("delivery", product)}の終了日：${customers.get(d.customerId) ?? ""}`,
      body: "修了の確認と、継続の提案を検討してください。",
      productId: d.productId,
    });
  }

  // 月末：締めの依頼
  let closingRequest = false;
  if (monthOf(addDays(t, 1)) !== monthOf(t)) {
    closingRequest = true;
    ctx.notifier.send({
      kind: "month.closing",
      to: users.filter((u) => u.role === "accounting").map((u) => u.email),
      title: `${monthOf(t)} の月次締めのお願い`,
      body: "売上台帳を確認し、月次締めを行ってください。",
    });
  }
  const imports = retryFailedImports(ctx);
  return { overdue, ending, closingRequest, imports };
}
