import { addDays, addMonths } from "./dates";
import type { ProgressTemplate, ProgressTemplateItem } from "./types";

export interface PlannedItem {
  templateItemId: string;
  name: string;
  seq: number;
  dueDate: string;
  completion: ProgressTemplateItem["completion"];
}

function step(date: string, repeat: ProgressTemplateItem["repeat"]): string {
  if (repeat === "weekly") return addDays(date, 7);
  if (repeat === "biweekly") return addDays(date, 14);
  if (repeat === "monthly") return addMonths(date, 1);
  return date;
}

/**
 * 進捗テンプレートから予定の進捗項目を並べる（8.1）。
 * 繰り返し項目は、終了日（の前日）まで予定を作る。
 */
export function planProgress(template: ProgressTemplate, startDate: string, endDate: string, maxItems = 200): PlannedItem[] {
  const out: PlannedItem[] = [];
  let prev = startDate;
  let seq = 0;
  for (const item of template.items) {
    const base = item.anchor === "start" ? startDate : item.anchor === "end" ? endDate : prev;
    let due = addDays(base, item.offsetDays);
    if (item.repeat === "none") {
      out.push({ templateItemId: item.id, name: item.name, seq: seq++, dueDate: due, completion: item.completion });
      prev = due;
      continue;
    }
    let n = item.repeatStartNumber ?? 1;
    while (due < endDate && out.length < maxItems) {
      const name = item.repeatName ? item.repeatName.replace("{n}", String(n)) : item.name;
      out.push({ templateItemId: item.id, name, seq: seq++, dueDate: due, completion: item.completion });
      prev = due;
      due = step(due, item.repeat);
      n += 1;
    }
  }
  return out;
}

/** 休止の期間（日数）だけ、指定日以降の予定をずらす（ZN-DLV-08） */
export function shiftDates<T extends { dueDate: string; status: string }>(items: T[], from: string, days: number): T[] {
  return items.map((i) => (i.status === "planned" && i.dueDate >= from ? { ...i, dueDate: addDays(i.dueDate, days) } : i));
}
