import type { EntityName, Settings } from "./types";

/**
 * 保存先の抽象。Apps Script ではスプレッドシート、ブラウザのデモでは localStorage、テストではメモリ。
 * Apps Script は同期実行なので、インターフェースも同期にする。
 */
export interface Store {
  all<T>(entity: EntityName): T[];
  get<T>(entity: EntityName, id: string): T | null;
  /** 追加または置き換え */
  put<T extends { id: string }>(entity: EntityName, row: T): T;
  remove(entity: EntityName, id: string): void;
  getSettings(): Settings | null;
  putSettings(settings: Settings): void;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export class MemoryStore implements Store {
  protected tables = new Map<EntityName, Map<string, unknown>>();
  protected settings: Settings | null = null;

  constructor(snapshot?: { tables?: Record<string, unknown[]>; settings?: Settings | null }) {
    if (snapshot?.tables) {
      for (const [k, rows] of Object.entries(snapshot.tables)) {
        const m = new Map<string, unknown>();
        for (const r of rows) m.set((r as { id: string }).id, r);
        this.tables.set(k as EntityName, m);
      }
    }
    this.settings = snapshot?.settings ?? null;
  }

  private table(entity: EntityName): Map<string, unknown> {
    let t = this.tables.get(entity);
    if (!t) {
      t = new Map();
      this.tables.set(entity, t);
    }
    return t;
  }

  all<T>(entity: EntityName): T[] {
    return [...this.table(entity).values()].map((r) => clone(r) as T);
  }

  get<T>(entity: EntityName, id: string): T | null {
    const r = this.table(entity).get(id);
    return r === undefined ? null : (clone(r) as T);
  }

  put<T extends { id: string }>(entity: EntityName, row: T): T {
    this.table(entity).set(row.id, clone(row));
    return clone(row);
  }

  remove(entity: EntityName, id: string): void {
    this.table(entity).delete(id);
  }

  getSettings(): Settings | null {
    return clone(this.settings);
  }

  putSettings(settings: Settings): void {
    this.settings = clone(settings);
  }

  snapshot(): { tables: Record<string, unknown[]>; settings: Settings | null } {
    const tables: Record<string, unknown[]> = {};
    for (const [k, t] of this.tables) tables[k] = [...t.values()];
    return clone({ tables, settings: this.settings });
  }
}

/** 元の保存先を変えずに書き込みを試す（テスト取り込み ZN-SET-09 用） */
export class OverlayStore implements Store {
  private writes = new Map<string, unknown | null>();
  private settings: Settings | null | undefined;

  constructor(private readonly base: Store) {}

  private key(entity: EntityName, id: string) {
    return `${entity}\u0000${id}`;
  }

  all<T>(entity: EntityName): T[] {
    const rows = new Map<string, T>();
    for (const r of this.base.all<T & { id: string }>(entity)) rows.set(r.id, r);
    for (const [k, v] of this.writes) {
      const [e, id] = k.split("\u0000") as [EntityName, string];
      if (e !== entity) continue;
      if (v === null) rows.delete(id);
      else rows.set(id, clone(v) as T);
    }
    return [...rows.values()];
  }

  get<T>(entity: EntityName, id: string): T | null {
    const k = this.key(entity, id);
    if (this.writes.has(k)) {
      const v = this.writes.get(k);
      return v === null ? null : (clone(v) as T);
    }
    return this.base.get<T>(entity, id);
  }

  put<T extends { id: string }>(entity: EntityName, row: T): T {
    this.writes.set(this.key(entity, row.id), clone(row));
    return clone(row);
  }

  remove(entity: EntityName, id: string): void {
    this.writes.set(this.key(entity, id), null);
  }

  getSettings(): Settings | null {
    return this.settings !== undefined ? clone(this.settings) : this.base.getSettings();
  }

  putSettings(settings: Settings): void {
    this.settings = clone(settings);
  }

  /** 書き込まれる予定の変更一覧 */
  changes(): { entity: EntityName; id: string; row: unknown | null }[] {
    return [...this.writes].map(([k, row]) => {
      const [entity, id] = k.split("\u0000") as [EntityName, string];
      return { entity, id, row };
    });
  }
}
