"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/admin", label: "契約一覧", exact: true },
  { href: "/admin/import", label: "既存の契約書を格納" },
  { href: "/admin/templates", label: "テンプレート" },
  { href: "/admin/clauses", label: "条項ライブラリ" },
  { href: "/admin/contacts", label: "連絡先" },
  { href: "/admin/audit", label: "監査ログ" },
  { href: "/admin/settings", label: "設定" },
];

export function AdminNav({ role }: { role: "owner" | "staff" }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:px-3">
      {ITEMS.filter((i) => role === "owner" || !["/admin/clauses"].includes(i.href)).map((i) => {
        const active = i.exact ? path === i.href || path.startsWith("/admin/contracts") : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cx(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
