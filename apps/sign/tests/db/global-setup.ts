import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

// テスト実行ごとに新しいDBを作り、Supabase相当のシムとマイグレーションを適用する
export default async function setup(project: TestProject) {
  const dbName = `sign_test_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(
      `テスト用PostgreSQLに接続できません（${ADMIN_URL}）。` +
        "`pnpm --filter @zelnora/sign db:test:start` で起動するか TEST_DATABASE_URL を設定してください。\n" +
        String(e),
    );
  }
  await admin.query(`create database ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const root = path.resolve(__dirname, "../../supabase");
  await db.query(readFileSync(path.join(root, "tests/supabase_shim.sql"), "utf8"));
  const migrations = readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await db.query(readFileSync(path.join(root, "migrations", m), "utf8"));
  }
  await db.end();
  project.provide("databaseUrl", url.toString());

  return async () => {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
