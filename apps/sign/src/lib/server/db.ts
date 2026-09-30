import "server-only";
import pg from "pg";

// タイムスタンプはISO文字列、numeric/bigintは文字列のまま扱う（精度を落とさない）
/** PostgreSQLのtimestamptz（例 "2026-09-30 16:17:05.664123+09"）をISO 8601（UTC）にする */
export function pgTimestampToIso(v: string): string {
  const iso = v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
pg.types.setTypeParser(1184, pgTimestampToIso); // timestamptz（セッションのタイムゾーンに依存しない）
pg.types.setTypeParser(1082, (v) => v); // date

export interface Db {
  query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

class PgDb implements Db {
  constructor(private readonly runner: pg.Pool | pg.PoolClient, private readonly inTx = false) {}

  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.runner.query(sql, params);
    return r.rows as T[];
  }

  async one<T extends object>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const client = await (this.runner as pg.Pool).connect();
    try {
      await client.query("begin");
      const result = await fn(new PgDb(client, true));
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    ssl: /sslmode=require|supabase\.(co|com)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return new PgDb(pool);
}
