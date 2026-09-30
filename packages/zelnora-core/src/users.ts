import { audit, type Ctx } from "./context";
import { nowIso } from "./dates";
import { can } from "./permissions";
import { getSettings } from "./settings";
import type { Deal, Delivery, Role, User } from "./types";
import { normalizeEmail, ZnError } from "./util";

export function listUsers(ctx: Ctx): User[] {
  return ctx.store.all<User>("users").sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function findUser(ctx: Ctx, email: string): User | null {
  return ctx.store.get<User>("users", normalizeEmail(email));
}

/** 最初のオーナーを登録する（利用者が1人もいない時だけ） */
export function bootstrapOwner(ctx: Ctx, email: string, name: string): User {
  if (ctx.store.all<User>("users").length > 0) throw new ZnError("すでに利用者が登録されています", "conflict");
  const id = normalizeEmail(email);
  const u: User = { id, email: id, name, role: "owner", productIds: [], active: true, capacity: null, createdAt: nowIso(ctx.clock) };
  ctx.store.put("users", u);
  audit(ctx, u, "user.bootstrap", "users", id);
  return u;
}

/**
 * ログインの制限（ZN-ROLE-05）：登録済みで有効な利用者、または許可ドメインのアカウントのみ。
 * 許可ドメインで未登録の場合は、権限の最も弱い「閲覧者」（担当商材なし）として登録する。
 */
export function authenticate(ctx: Ctx, email: string): User {
  const id = normalizeEmail(email);
  const u = ctx.store.get<User>("users", id);
  if (u) {
    if (!u.active) throw new ZnError("このアカウントは無効になっています", "forbidden");
    return u;
  }
  const domain = id.split("@")[1] ?? "";
  const allowed = getSettings(ctx).allowedDomains.map((d) => d.toLowerCase().replace(/^@/, ""));
  if (domain && allowed.includes(domain)) {
    const created: User = { id, email: id, name: id.split("@")[0]!, role: "viewer", productIds: [], active: true, capacity: null, createdAt: nowIso(ctx.clock) };
    ctx.store.put("users", created);
    audit(ctx, created, "user.auto_register", "users", id, { domain });
    return created;
  }
  throw new ZnError("このGoogleアカウントでは利用できません。管理者に登録を依頼してください", "forbidden");
}

export function saveUser(ctx: Ctx, actor: User, input: { email: string; name: string; role: Role; productIds: string[]; active: boolean; capacity?: number | null }): User {
  if (!can(actor, "users.manage")) throw new ZnError("利用者を管理する権限がありません", "forbidden");
  const id = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) throw new ZnError("メールアドレスの形式が正しくありません");
  const existing = ctx.store.get<User>("users", id);
  if (actor.role !== "owner" && (input.role === "owner" || existing?.role === "owner")) {
    throw new ZnError("オーナーの登録・変更はオーナーのみ可能です", "forbidden");
  }
  if (existing?.role === "owner" && input.role !== "owner") {
    const owners = ctx.store.all<User>("users").filter((u) => u.role === "owner" && u.active);
    if (owners.length <= 1) throw new ZnError("最後のオーナーのロールは変更できません", "conflict");
  }
  const u: User = {
    id,
    email: id,
    name: input.name.trim() || id,
    role: input.role,
    productIds: input.productIds,
    active: input.active,
    capacity: input.capacity ?? null,
    createdAt: existing?.createdAt ?? nowIso(ctx.clock),
  };
  ctx.store.put("users", u);
  audit(ctx, actor, existing ? "user.update" : "user.create", "users", id, { role: u.role, productIds: u.productIds, active: u.active });
  return u;
}

/** 担当の一括付け替え（ZN-ROLE-04）：商談と提供をまとめて別の担当者へ移す */
export function reassignOwner(
  ctx: Ctx,
  actor: User,
  input: { from: string; to: string; productId?: string | null; deals: boolean; deliveries: boolean; customers: boolean },
): { deals: number; deliveries: number; customers: number } {
  if (!can(actor, "assign.change")) throw new ZnError("担当を変更する権限がありません", "forbidden");
  const from = normalizeEmail(input.from);
  const to = normalizeEmail(input.to);
  const target = ctx.store.get<User>("users", to);
  if (!target?.active) throw new ZnError("移し先の担当者が見つかりません");
  const inScope = (productId: string) =>
    (!input.productId || productId === input.productId) && (actor.role !== "manager" || actor.productIds.includes(productId));
  const now = nowIso(ctx.clock);
  let d = 0;
  let v = 0;
  let c = 0;
  if (input.deals) {
    for (const deal of ctx.store.all<Deal>("deals")) {
      if (deal.owner === from && deal.status === "open" && inScope(deal.productId)) {
        ctx.store.put("deals", { ...deal, owner: to, updatedAt: now, version: deal.version + 1 });
        d++;
      }
    }
  }
  if (input.deliveries) {
    for (const dv of ctx.store.all<Delivery>("deliveries")) {
      if (dv.owner === from && (dv.status === "active" || dv.status === "paused") && inScope(dv.productId)) {
        ctx.store.put("deliveries", { ...dv, owner: to, updatedAt: now, version: dv.version + 1 });
        v++;
      }
    }
  }
  if (input.customers) {
    for (const cu of ctx.store.all<{ id: string; salesOwner: string | null; version: number; updatedAt: string }>("customers")) {
      if (cu.salesOwner === from) {
        ctx.store.put("customers", { ...cu, salesOwner: to, updatedAt: now, version: cu.version + 1 });
        c++;
      }
    }
  }
  audit(ctx, actor, "owner.reassign", "users", from, { to, productId: input.productId ?? null, deals: d, deliveries: v, customers: c });
  ctx.notifier.send({ kind: "reassign", to: [to], title: "担当が引き継がれました", body: `${from} から 商談${d}件・提供${v}件 を引き継ぎました。` });
  return { deals: d, deliveries: v, customers: c };
}
