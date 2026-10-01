import { PageHeader } from "@/components/ui";
import { ImportForm } from "./form";

export const metadata = { title: "既存の契約書を格納" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="既存の契約書を格納"
        description="紙で締結してスキャンした契約書や、他のサービスで締結した契約書（PDF）を保管します。格納したPDFは変更・削除できず、タイムスタンプが付きます。"
      />
      <ImportForm />
    </>
  );
}
