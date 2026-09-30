/**
 * 初期テンプレート（受講契約書）と条項ライブラリを登録する。
 *   pnpm --filter @zelnora/sign seed <オーナーのemail>
 */
import { createDb } from "../src/lib/server/db";
import { seedCourseTemplate } from "../src/lib/server/seed";

async function main() {
  const email = process.argv[2];
  const db = createDb(process.env.DATABASE_URL ?? "");
  const owner = await db.one<{ id: string; email: string }>(
    email ? "select id, email from public.admins where lower(email) = lower($1) and role = 'owner'" : "select id, email from public.admins where role = 'owner' order by created_at limit 1",
    email ? [email] : [],
  );
  if (!owner) throw new Error("オーナーが見つかりません。先に bootstrap-owner を実行してください");
  const r = await seedCourseTemplate(db, { id: owner.id, email: owner.email, role: "owner" });
  console.log(r.created ? `受講契約書を登録しました（template_id=${r.templateId}）` : "受講契約書は登録済みです");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
