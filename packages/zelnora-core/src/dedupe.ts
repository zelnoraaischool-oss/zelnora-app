import type { Customer } from "./types";
import { normalizeEmail, normalizeName, normalizePhone } from "./util";

export interface DuplicateGroup {
  key: string;
  reason: "email" | "phone" | "name_phone";
  customerIds: string[];
}

/** メールと電話を正規化して重複の候補を出す（ZN-CUS-07） */
export function findDuplicateGroups(customers: Customer[]): DuplicateGroup[] {
  const active = customers.filter((c) => !c.mergedInto);
  const groups = new Map<string, DuplicateGroup>();
  const add = (reason: DuplicateGroup["reason"], key: string, id: string) => {
    if (!key) return;
    const k = `${reason}:${key}`;
    const g = groups.get(k) ?? { key, reason, customerIds: [] };
    if (!g.customerIds.includes(id)) g.customerIds.push(id);
    groups.set(k, g);
  };
  for (const c of active) {
    add("email", normalizeEmail(c.email), c.id);
    const p = normalizePhone(c.phone);
    if (p.length >= 10) add("phone", p, c.id);
  }
  const out = [...groups.values()].filter((g) => g.customerIds.length > 1);
  // 同じ組み合わせは1つにまとめる
  const seen = new Set<string>();
  return out.filter((g) => {
    const k = [...g.customerIds].sort().join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 取り込み時に同じ人を探す：メール（正規化）→ 電話 の順 */
export function matchCustomer(customers: Customer[], input: { email?: string; phone?: string }, by: ("email" | "phone")[]): Customer[] {
  const active = customers.filter((c) => !c.mergedInto);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const found = new Map<string, Customer>();
  if (by.includes("email") && email) for (const c of active) if (normalizeEmail(c.email) === email) found.set(c.id, c);
  if (by.includes("phone") && phone.length >= 10) for (const c of active) if (normalizePhone(c.phone) === phone) found.set(c.id, c);
  return [...found.values()];
}

export function sameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
