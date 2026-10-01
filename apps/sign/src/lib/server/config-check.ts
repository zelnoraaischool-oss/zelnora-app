import "server-only";

export interface ConfigItem {
  name: string;
  label: string;
}

/**
 * 本番で必要な環境変数のうち、未設定のもの（値は返さない）。
 * Vercel につないだ直後に、何を設定すればよいかを画面に出すために使う。
 */
export function missingConfig(env: Record<string, string | undefined> = process.env): ConfigItem[] {
  const has = (k: string) => !!env[k]?.trim();
  const dev = env.AUTH_DRIVER === "dev" && env.NODE_ENV !== "production";
  const items: (ConfigItem & { need: boolean })[] = [
    { name: "DATABASE_URL", label: "データベース（Supabase の接続文字列）", need: true },
    { name: "APP_URL", label: "このサイトの公開URL", need: !dev },
    { name: "SESSION_SECRET", label: "署名者セッションの秘密値", need: !dev },
    { name: "OTP_SECRET", label: "確認コードの秘密値", need: !dev },
    { name: "TOKEN_ENCRYPTION_KEY", label: "署名URLの暗号鍵", need: !dev },
    { name: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase のURL（管理者ログイン）", need: !dev },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase の anon キー", need: !dev },
    { name: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase の service_role キー（PDFの保存）", need: !dev && env.STORAGE_DRIVER !== "local" },
    { name: "RESEND_API_KEY", label: "メール送信（Resend）のAPIキー", need: !dev },
    { name: "MAIL_FROM", label: "メールの送信元", need: !dev || has("RESEND_API_KEY") },
    { name: "TSA_URL", label: "タイムスタンプ局のURL", need: true },
    { name: "CRON_SECRET", label: "定期実行の秘密値", need: !dev },
  ];
  return items.filter((i) => i.need && !has(i.name)).map(({ name, label }) => ({ name, label }));
}
