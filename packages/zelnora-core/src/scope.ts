import type { Ctx } from "./context";
import { masksContact, ownRowsOnly, productAllowed } from "./permissions";
import { getSettings } from "./settings";
import type { Customer, Deal, Delivery, Revenue, User } from "./types";
import { maskEmail, maskPhone } from "./util";

/** 利用者が見られる商談（ZN-ROLE-01/02：判定はAPI側で行う） */
export function visibleDeals(ctx: Ctx, user: User, deals = ctx.store.all<Deal>("deals")): Deal[] {
  const own = ownRowsOnly(user);
  if (own === "delivery") {
    const custIds = new Set(visibleDeliveries(ctx, user).map((d) => d.customerId));
    return deals.filter((d) => custIds.has(d.customerId) && productAllowed(user, d.productId));
  }
  return deals.filter((d) => productAllowed(user, d.productId) && (own !== "sales" || d.owner === user.email));
}

/** 利用者が見られる提供：提供担当は自分の担当、営業担当は自分の商談の顧客の提供（閲覧のみ） */
export function visibleDeliveries(ctx: Ctx, user: User, deliveries = ctx.store.all<Delivery>("deliveries")): Delivery[] {
  const own = ownRowsOnly(user);
  let salesCustomers: Set<string> | null = null;
  if (own === "sales") {
    salesCustomers = new Set();
    for (const d of ctx.store.all<Deal>("deals")) if (d.owner === user.email) salesCustomers.add(d.customerId);
    for (const c of ctx.store.all<Customer>("customers")) if (c.salesOwner === user.email) salesCustomers.add(c.id);
  }
  return deliveries.filter(
    (d) =>
      productAllowed(user, d.productId) &&
      (own !== "delivery" || d.owner === user.email) &&
      (salesCustomers === null || salesCustomers.has(d.customerId)),
  );
}

/** 顧客の可視範囲：営業担当は自分の商談の顧客、提供担当は自分の提供の顧客、他は担当商材の顧客 */
export function visibleCustomerIds(ctx: Ctx, user: User): Set<string> | "all" {
  if (user.role === "owner" || user.role === "admin" || user.role === "accounting") return "all";
  const own = ownRowsOnly(user);
  const ids = new Set<string>();
  if (own === "sales") {
    for (const d of ctx.store.all<Deal>("deals")) if (d.owner === user.email && productAllowed(user, d.productId)) ids.add(d.customerId);
    for (const c of ctx.store.all<Customer>("customers")) if (c.salesOwner === user.email) ids.add(c.id);
    return ids;
  }
  if (own === "delivery") {
    for (const d of ctx.store.all<Delivery>("deliveries")) if (d.owner === user.email) ids.add(d.customerId);
    return ids;
  }
  // マネージャー・閲覧者：担当商材に商談・提供がある顧客
  for (const d of ctx.store.all<Deal>("deals")) if (productAllowed(user, d.productId)) ids.add(d.customerId);
  for (const d of ctx.store.all<Delivery>("deliveries")) if (productAllowed(user, d.productId)) ids.add(d.customerId);
  return ids;
}

export function canSeeCustomer(ctx: Ctx, user: User, customerId: string): boolean {
  const v = visibleCustomerIds(ctx, user);
  return v === "all" || v.has(customerId);
}

export function visibleRevenues(ctx: Ctx, user: User, rows = ctx.store.all<Revenue>("revenues")): Revenue[] {
  if (user.role === "delivery" || user.role === "viewer") return [];
  if (user.role === "sales") return rows.filter((r) => r.owner === user.email && productAllowed(user, r.productId));
  return rows.filter((r) => productAllowed(user, r.productId));
}

/** 閲覧者などには連絡先を伏せる（ZN-ROLE-03） */
export function maskCustomer(ctx: Ctx, user: User, c: Customer): Customer {
  const masked = getSettings(ctx).maskedFields;
  return {
    ...c,
    email: masksContact(user, masked, "email") ? maskEmail(c.email) : c.email,
    phone: masksContact(user, masked, "phone") ? maskPhone(c.phone) : c.phone,
  };
}
