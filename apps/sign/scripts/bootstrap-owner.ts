/**
 * 最初のオーナー（管理者）を作成する。
 *   pnpm --filter @zelnora/sign bootstrap-owner <email> [password]
 * Supabaseの環境変数があれば Supabase Auth にユーザーを作成し、なければ（ローカル開発用）auth.users に直接登録する。
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createDb } from "../src/lib/server/db";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email) throw new Error("使い方: bootstrap-owner <email> [password]");
  const db = createDb(process.env.DATABASE_URL ?? "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let userId: string;
  if (url && key && process.env.AUTH_DRIVER !== "dev") {
    if (!password || password.length < 12) throw new Error("12文字以上のパスワードを指定してください");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  } else {
    const existing = await db.one<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email]);
    userId = existing?.id ?? randomUUID();
    if (!existing) await db.query("insert into auth.users (id, email) values ($1, $2)", [userId, email]);
  }
  await db.query(
    `insert into public.admins (id, email, role) values ($1, $2, 'owner')
     on conflict (id) do update set role = 'owner', disabled_at = null`,
    [userId, email.toLowerCase()],
  );
  await db.query(
    `insert into public.audit_events (actor_type, event_type, payload) values ('system', 'admin.invited', $1)`,
    [JSON.stringify({ email, role: "owner", via: "bootstrap-owner" })],
  );
  console.log(`オーナーを登録しました: ${email}（初回ログイン時に認証アプリの登録が必要です）`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
