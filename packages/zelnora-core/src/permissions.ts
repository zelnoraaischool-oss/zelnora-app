import type { Role, User } from "./types";

export type Action =
  | "customers.view"
  | "customers.edit"
  | "customers.merge"
  | "deals.view"
  | "deals.edit"
  | "assign.change"
  | "deliveries.view"
  | "deliveries.edit"
  | "revenues.view"
  | "revenues.summary"
  | "revenues.edit"
  | "months.close"
  | "months.reopen"
  | "settings.products"
  | "settings.sources"
  | "users.manage"
  | "audit.view"
  | "csv.export";

/** 4.2 ロールと権限（行の絞り込みは scope 系の関数で行う） */
const MATRIX: Record<Action, Role[]> = {
  "customers.view": ["owner", "admin", "manager", "sales", "delivery", "accounting", "viewer"],
  "customers.edit": ["owner", "admin", "manager", "sales", "delivery"],
  "customers.merge": ["owner", "admin"],
  "deals.view": ["owner", "admin", "manager", "sales", "delivery", "accounting", "viewer"],
  "deals.edit": ["owner", "admin", "manager", "sales"],
  "assign.change": ["owner", "admin", "manager"],
  "deliveries.view": ["owner", "admin", "manager", "sales", "delivery", "accounting", "viewer"],
  "deliveries.edit": ["owner", "admin", "manager", "delivery"],
  "revenues.view": ["owner", "admin", "manager", "sales", "accounting"],
  "revenues.summary": ["owner", "admin", "manager", "sales", "accounting", "viewer"],
  "revenues.edit": ["owner", "admin", "accounting"],
  "months.close": ["owner", "admin", "accounting"],
  "months.reopen": ["owner"],
  "settings.products": ["owner", "admin"],
  "settings.sources": ["owner"],
  "users.manage": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
  "csv.export": ["owner", "admin", "manager", "accounting"],
};

export function can(user: Pick<User, "role">, action: Action): boolean {
  return MATRIX[action].includes(user.role);
}

/** 全商材を扱えるロール */
export function allProducts(user: Pick<User, "role">): boolean {
  return user.role === "owner" || user.role === "admin" || user.role === "accounting";
}

export function productAllowed(user: Pick<User, "role" | "productIds">, productId: string): boolean {
  return allProducts(user) || user.productIds.includes(productId);
}

/** 行単位で「自分の担当」だけに絞るロール（ZN-ROLE-02） */
export function ownRowsOnly(user: Pick<User, "role">): "sales" | "delivery" | null {
  if (user.role === "sales") return "sales";
  if (user.role === "delivery") return "delivery";
  return null;
}

/** 連絡先を伏せるか（ZN-ROLE-03） */
export function masksContact(user: Pick<User, "role">, masked: { field: "email" | "phone"; roles: Role[] }[], field: "email" | "phone"): boolean {
  const rule = masked.find((m) => m.field === field);
  if (rule) return rule.roles.includes(user.role);
  return user.role === "viewer";
}
