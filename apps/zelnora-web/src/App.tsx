import { can } from "@zelnora/core";
import { NavLink, Route, Routes } from "react-router-dom";
import { Login } from "./components/login";
import { cx } from "./components/ui";
import { DEMO } from "./lib/config";
import { SessionProvider, useSession } from "./lib/session";
import { AuditPage } from "./pages/audit";
import { CustomerDetailPage } from "./pages/customer-detail";
import { CustomersPage } from "./pages/customers";
import { DeliveryPage } from "./pages/delivery";
import { DuplicatesPage } from "./pages/duplicates";
import { HomePage } from "./pages/home";
import { RegistrationsPage } from "./pages/registrations";
import { RevenuePage } from "./pages/revenue";
import { SalesPage } from "./pages/sales";
import { SettingsPage } from "./pages/settings";
import { WizardPage } from "./pages/wizard";

export function App() {
  return (
    <SessionProvider login={(onSignedIn) => <Login onSignedIn={onSignedIn} />}>
      <Shell />
    </SessionProvider>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: "オーナー", admin: "管理者", manager: "マネージャー", sales: "営業担当", delivery: "提供担当", accounting: "経理", viewer: "閲覧者" };

function Shell() {
  const s = useSession();
  const L = s.labels();
  const nav = [
    { to: "/", label: "ホーム", show: true },
    { to: "/customers", label: `${L.customer}`, show: can(s.user, "customers.view") },
    { to: "/sales", label: "営業", show: can(s.user, "deals.view") },
    { to: "/delivery", label: L.delivery, show: can(s.user, "deliveries.view") },
    { to: "/revenue", label: L.revenue, show: can(s.user, "revenues.summary") },
    { to: "/registrations", label: `${L.registration}の確認`, show: can(s.user, "assign.change") },
    { to: "/settings", label: "設定", show: can(s.user, "settings.products") || can(s.user, "users.manage") },
    { to: "/audit", label: "監査ログ", show: can(s.user, "audit.view") },
  ].filter((n) => n.show);
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 lg:block lg:py-5">
          <div>
            <div className="text-lg font-bold text-brand-700">Zelnora</div>
            <div className="text-xs text-slate-500">{s.settings.organizationName}</div>
          </div>
          {DEMO && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 lg:mt-2 lg:inline-block">デモ</span>}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:px-3" aria-label="メインメニュー">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => cx("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium", isActive ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 py-4 text-xs text-slate-500 lg:mt-auto lg:block">
          <div className="truncate font-semibold text-slate-700">{s.user.name}</div>
          <div className="truncate">{s.user.email}</div>
          <div>{ROLE_LABEL[s.user.role]}</div>
          <button type="button" className="mt-2 underline" onClick={s.signOut}>
            {DEMO ? "ロールを切り替える" : "ログアウト"}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/duplicates" element={<DuplicatesPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/delivery" element={<DeliveryPage />} />
          <Route path="/revenue" element={<RevenuePage />} />
          <Route path="/registrations" element={<RegistrationsPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/wizard" element={<WizardPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<p className="py-10 text-center text-slate-500">ページが見つかりません</p>} />
        </Routes>
        <div className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-500 lg:hidden">
          {s.user.name}（{ROLE_LABEL[s.user.role]}）{" "}
          <button type="button" className="underline" onClick={s.signOut}>
            {DEMO ? "ロールを切り替える" : "ログアウト"}
          </button>
        </div>
      </main>
    </div>
  );
}
