import { can } from "@zelnora/core";
import { useState } from "react";
import { LinkButton, PageHeader, Tabs } from "../../components/ui";
import { useSession } from "../../lib/session";
import { FormsSettings } from "./forms";
import { GeneralSettings, VersionsSettings } from "./general";
import { PlansSettings } from "./plans";
import { ProductsSettings } from "./products";
import { SourcesSettings } from "./sources";
import { UsersSettings } from "./users";

type Tab = "products" | "plans" | "forms" | "sources" | "users" | "general" | "versions";

export function SettingsPage() {
  const s = useSession();
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "products", label: s.labels().product, show: can(s.user, "settings.products") },
    { id: "plans", label: s.labels().plan, show: can(s.user, "settings.products") },
    { id: "forms", label: "フォームの対応付け", show: can(s.user, "settings.sources") },
    { id: "sources", label: "データソース登録簿", show: can(s.user, "settings.sources") },
    { id: "users", label: "利用者とロール", show: can(s.user, "users.manage") },
    { id: "general", label: "基本設定", show: can(s.user, "settings.products") },
    { id: "versions", label: "版の履歴", show: can(s.user, "settings.products") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.id ?? "users");
  return (
    <>
      <PageHeader
        title="設定"
        description={`設定を変えるたびに版を残し、いつでも前の版に戻せます（現在 第${s.settings.version}版）。`}
        actions={can(s.user, "settings.products") ? <LinkButton to="/wizard" variant="primary">＋ 設定ウィザードで{s.labels().product}を追加</LinkButton> : undefined}
      />
      <Tabs value={tab} onChange={setTab} tabs={visible} />
      {tab === "products" && <ProductsSettings />}
      {tab === "plans" && <PlansSettings />}
      {tab === "forms" && <FormsSettings />}
      {tab === "sources" && <SourcesSettings />}
      {tab === "users" && <UsersSettings />}
      {tab === "general" && <GeneralSettings />}
      {tab === "versions" && <VersionsSettings />}
    </>
  );
}
