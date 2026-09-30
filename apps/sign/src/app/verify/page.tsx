import type { Metadata } from "next";
import { Verifier } from "./verifier";

export const metadata: Metadata = { title: "契約書の検証" };

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold">契約書の検証</h1>
      <p className="mt-2 text-sm text-slate-600">
        お手元の確定版PDFが、このシステムで締結された契約書と一致するか（改ざんされていないか）を確認できます。
        PDFはお使いの端末の中でハッシュ値（SHA-256）を計算するだけで、サーバーには送信・保存されません。
      </p>
      <Verifier />
    </main>
  );
}
