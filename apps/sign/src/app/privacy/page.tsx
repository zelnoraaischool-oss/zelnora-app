import type { Metadata } from "next";
import { deps } from "@/lib/server/deps";
import { getSettings } from "@/lib/server/settings";

export const metadata: Metadata = { title: "プライバシーポリシー" };
export const dynamic = "force-dynamic";

// 注：文面は雛形です。運用前に発注者が内容を確定させてください（要件定義書10章）。
export default async function PrivacyPage() {
  const s = await getSettings(deps().db);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">プライバシーポリシー（電子契約）</h1>
      <div className="contract-body mt-6">
        <p>{s.organization_name}（以下「当事業者」）は、電子契約の締結にあたり取得する個人情報を、次のとおり取り扱います。</p>
        <h2>1. 取得する情報</h2>
        <ul>
          <li>氏名、メールアドレス、電話番号、住所など、契約書に記載する事項</li>
          <li>ご本人確認のための確認コードの送受信記録</li>
          <li>契約書の閲覧・同意・署名の日時、IPアドレス、ブラウザの種類（ユーザーエージェント）</li>
          <li>任意で入力された手書きサインの画像</li>
        </ul>
        <h2>2. 利用目的</h2>
        <ul>
          <li>契約の締結・履行、及びそのためのご連絡</li>
          <li>契約が真正に成立したことの証明（紛争の防止・解決を含む）</li>
          <li>法令に基づく記録の保存</li>
        </ul>
        <h2>3. 保存期間</h2>
        <p>締結された契約とその記録は、法令上の保存義務等を踏まえ、締結から少なくとも7年間保存します。締結に至らなかった契約の個人情報は、一定期間の経過後に匿名化します。</p>
        <h2>4. 第三者提供</h2>
        <p>法令に基づく場合を除き、ご本人の同意なく第三者に提供しません。なお、メール送信・データ保管・時刻証明（タイムスタンプ）のため、外部の事業者に取扱いを委託することがあります。</p>
        <h2>5. 安全管理</h2>
        <p>通信の暗号化、アクセス権限の管理、操作記録の保存等により、個人情報を安全に管理します。</p>
        <h2>6. お問い合わせ</h2>
        <p>
          個人情報の開示・訂正・利用停止等のご請求は、{s.organization_name}
          {s.admin_notify_email ? `（${s.admin_notify_email}）` : ""}までご連絡ください。
        </p>
      </div>
    </main>
  );
}
