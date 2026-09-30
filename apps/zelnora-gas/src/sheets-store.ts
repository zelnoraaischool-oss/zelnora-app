// スプレッドシートを正本とする保存先（要件 1.6, 2.4）。
// エンティティ → タブ・列の対応は「データソース登録簿」で決める。登録がないエンティティは
// アプリ用のDBスプレッドシートにエンティティ名のタブを自動で作る。
import { type DataSource, type EntityName, jstDate, type Settings, type Store, ZnError } from "@zelnora/core";

export interface RangeLike {
  getValues(): unknown[][];
  setValues(values: unknown[][]): unknown;
  setNumberFormat?(format: string): unknown;
}
export interface SheetLike {
  getName(): string;
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, column: number, numRows?: number, numColumns?: number): RangeLike;
  deleteRow(row: number): unknown;
  setFrozenRows?(rows: number): unknown;
}
export interface BookLike {
  getId(): string;
  getSheetByName(name: string): SheetLike | null;
  insertSheet(name: string): SheetLike;
}
export type OpenBook = (id: string) => BookLike;

type Kind = "json" | "num" | "bool";

/** エンティティごとの、文字列以外の項目 */
export const SCHEMA: Record<EntityName, Record<string, Kind>> = {
  users: { productIds: "json", active: "bool", capacity: "num" },
  customers: { tags: "json", custom: "json", version: "num" },
  deals: { amount: "num", fields: "json", nextAction: "json", history: "json", version: "num" },
  contracts: { amountIncl: "num" },
  registrations: { answers: "json", questions: "json" },
  deliveries: { nextAction: "json", pauses: "json", satisfaction: "json", fields: "json", version: "num" },
  progress: { seq: "num", record: "json" },
  activities: { durationMin: "num" },
  revenues: { amountExcl: "num", tax: "num", amountIncl: "num", paidAmount: "num", installmentNo: "num" },
  closings: {},
  targets: { count: "num", amount: "num" },
  audit: {},
  imports: { attempts: "num" },
  savedViews: { shared: "bool", columns: "json" },
  settingsVersions: { version: "num" },
};

const SETTINGS_TAB = "_settings";
const CHUNK = 40000;

interface Table {
  sheet: SheetLike;
  headerRow: number;
  headers: string[];
  /** 項目キー → 列見出し（外部シート）。null ならアプリ管理のタブ（見出し＝項目キー） */
  columns: Record<string, string> | null;
  rows: Map<string, { row: number; obj: Record<string, unknown> }>;
  nextRow: number;
  dirty: Map<string, Record<string, unknown>>;
  deleted: Set<string>;
  blocked: string | null;
  source: DataSource | null;
  shadow: Table | null;
}

function toCell(v: unknown, kind: Kind | undefined): unknown {
  if (v === null || v === undefined) return "";
  if (kind === "json") return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fromCell(v: unknown, kind: Kind | undefined): unknown {
  if (v instanceof Date) {
    // シートが日付に変換した値：日本時間の0時ちょうどなら日付、それ以外は日時として扱う
    const j = new Date(v.getTime() + 9 * 3600_000);
    v = j.getUTCHours() === 0 && j.getUTCMinutes() === 0 && j.getUTCSeconds() === 0 ? jstDate(v) : v.toISOString();
  }
  if (kind === "json") {
    if (v === "" || v === null || v === undefined) return null;
    try {
      return JSON.parse(String(v));
    } catch {
      return null;
    }
  }
  if (kind === "num") return v === "" || v === null || v === undefined ? null : Number(v);
  if (kind === "bool") return v === true || v === "true" || v === "TRUE";
  return v === null || v === undefined ? "" : String(v);
}

export class SheetsStore implements Store {
  private tables = new Map<string, Table>();
  private settings: Settings | null | undefined;
  private settingsDirty = false;

  constructor(
    private readonly open: OpenBook,
    private readonly dbId: string,
    private readonly onProblem: (ds: DataSource, message: string) => void = () => {},
  ) {}

  private db(): BookLike {
    return this.open(this.dbId);
  }

  private sheetIn(book: BookLike, name: string, create: boolean): SheetLike | null {
    const s = book.getSheetByName(name);
    if (s || !create) return s;
    const n = book.insertSheet(name);
    n.setFrozenRows?.(1);
    return n;
  }

  private sourceFor(entity: EntityName): DataSource | null {
    const s = this.getSettings();
    return s?.dataSources.find((d) => d.entity === entity && d.status !== "stopped") ?? null;
  }

  private loadTable(tabKey: string, sheet: SheetLike, headerRow: number, columns: Record<string, string> | null, source: DataSource | null, entity: EntityName): Table {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const headers = lastRow >= headerRow && lastCol > 0 ? sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0]!.map((h) => String(h).trim()) : [];
    const t: Table = { sheet, headerRow, headers, columns, rows: new Map(), nextRow: Math.max(lastRow, headerRow) + 1, dirty: new Map(), deleted: new Set(), blocked: null, source, shadow: null };
    if (columns) {
      const missing = Object.values(columns).filter((h) => !headers.includes(h));
      if (!("id" in columns)) t.blocked = `データソース「${source?.name}」に「id」の列の対応がありません`;
      else if (missing.length) t.blocked = `データソース「${source?.name}」の見出しが想定と違います（見つからない列：${missing.join("、")}）。書き込みを止めました`;
      if (t.blocked && source) this.onProblem(source, t.blocked);
    }
    const schema = SCHEMA[entity] ?? {};
    const keyOfCol = (i: number): string | null => {
      const h = headers[i]!;
      if (!columns) return h || null;
      const found = Object.entries(columns).find(([, header]) => header === h);
      return found ? found[0] : null;
    };
    if (lastRow > headerRow && lastCol > 0) {
      const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
      values.forEach((row, i) => {
        const obj: Record<string, unknown> = {};
        row.forEach((cell, c) => {
          const key = keyOfCol(c);
          if (key) obj[key] = fromCell(cell, schema[key]);
        });
        const id = obj.id ? String(obj.id) : "";
        if (id) t.rows.set(id, { row: headerRow + 1 + i, obj });
      });
    }
    this.tables.set(tabKey, t);
    return t;
  }

  private table(entity: EntityName): Table {
    const cached = this.tables.get(entity);
    if (cached) return cached;
    const ds = this.sourceFor(entity);
    if (ds) {
      const book = this.open(ds.spreadsheetId);
      const sheet = this.sheetIn(book, ds.sheetName, false);
      if (!sheet) throw new ZnError(`データソース「${ds.name}」のタブ「${ds.sheetName}」が見つかりません`, "data_source");
      const t = this.loadTable(entity, sheet, ds.headerRow || 1, ds.columns, ds, entity);
      // 対応のない項目は、DB内の影のタブに保存する
      const shadowSheet = this.sheetIn(this.db(), `_ext_${entity}`, true)!;
      t.shadow = this.loadTable(`_ext_${entity}`, shadowSheet, 1, null, null, entity);
      return t;
    }
    const sheet = this.sheetIn(this.db(), entity, true)!;
    return this.loadTable(entity, sheet, 1, null, null, entity);
  }

  all<T>(entity: EntityName): T[] {
    const t = this.table(entity);
    return [...t.rows.keys()].map((id) => this.merged(t, id) as T);
  }

  get<T>(entity: EntityName, id: string): T | null {
    const t = this.table(entity);
    return t.rows.has(id) ? (this.merged(t, id) as T) : null;
  }

  private merged(t: Table, id: string): Record<string, unknown> {
    const base = JSON.parse(JSON.stringify(t.rows.get(id)!.obj)) as Record<string, unknown>;
    if (t.shadow?.rows.has(id)) {
      const extra = t.shadow.rows.get(id)!.obj;
      for (const [k, v] of Object.entries(extra)) if (!(k in base) || base[k] === "" || base[k] === null) base[k] = v;
    }
    return base;
  }

  put<T extends { id: string }>(entity: EntityName, row: T): T {
    const t = this.table(entity);
    if (t.blocked) throw new ZnError(t.blocked, "data_source");
    const obj = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    const existing = t.rows.get(row.id);
    t.rows.set(row.id, { row: existing?.row ?? -1, obj });
    t.dirty.set(row.id, obj);
    t.deleted.delete(row.id);
    if (t.shadow && t.columns) {
      const extra: Record<string, unknown> = { id: row.id };
      for (const [k, v] of Object.entries(obj)) if (!(k in t.columns)) extra[k] = v;
      const se = t.shadow.rows.get(row.id);
      t.shadow.rows.set(row.id, { row: se?.row ?? -1, obj: extra });
      t.shadow.dirty.set(row.id, extra);
    }
    return row;
  }

  remove(entity: EntityName, id: string): void {
    const t = this.table(entity);
    if (t.blocked) throw new ZnError(t.blocked, "data_source");
    if (!t.rows.has(id)) return;
    t.deleted.add(id);
    t.dirty.delete(id);
    if (t.shadow?.rows.has(id)) t.shadow.deleted.add(id);
  }

  getSettings(): Settings | null {
    if (this.settings !== undefined) return this.settings ? (JSON.parse(JSON.stringify(this.settings)) as Settings) : null;
    const sheet = this.sheetIn(this.db(), SETTINGS_TAB, false);
    if (!sheet || sheet.getLastRow() < 1) {
      this.settings = null;
      return null;
    }
    const text = sheet
      .getRange(1, 1, sheet.getLastRow(), 1)
      .getValues()
      .map((r) => String(r[0] ?? ""))
      .join("");
    this.settings = text ? (JSON.parse(text) as Settings) : null;
    return this.settings ? (JSON.parse(JSON.stringify(this.settings)) as Settings) : null;
  }

  putSettings(settings: Settings): void {
    this.settings = JSON.parse(JSON.stringify(settings)) as Settings;
    this.settingsDirty = true;
    // データソースの設定が変わるかもしれないため、未保存の変更を書き込んでから読み直す
    this.flushTables();
    this.tables.clear();
  }

  /** 変更をまとめてシートに書き込む */
  flush(): void {
    if (this.settingsDirty && this.settings) {
      const sheet = this.sheetIn(this.db(), SETTINGS_TAB, true)!;
      const text = JSON.stringify(this.settings);
      const chunks: string[][] = [];
      for (let i = 0; i < text.length; i += CHUNK) chunks.push([text.slice(i, i + CHUNK)]);
      const old = sheet.getLastRow();
      const range = sheet.getRange(1, 1, chunks.length, 1);
      range.setNumberFormat?.("@");
      range.setValues(chunks);
      for (let r = old; r > chunks.length; r--) sheet.deleteRow(r);
      this.settingsDirty = false;
    }
    this.flushTables();
  }

  private flushTables(): void {
    for (const [key, t] of this.tables) this.flushTable(key.startsWith("_ext_") ? (key.slice(5) as EntityName) : (key as EntityName), t);
  }

  private flushTable(entity: EntityName, t: Table): void {
    if (!t.dirty.size && !t.deleted.size) return;
    const schema = SCHEMA[entity] ?? {};
    // アプリ管理のタブは、新しい項目の列を右端に足す（先頭列は id）
    if (!t.columns) {
      const have = new Set(t.headers.filter(Boolean));
      const add: string[] = [];
      for (const obj of t.dirty.values()) {
        for (const k of Object.keys(obj)) {
          if (!have.has(k)) {
            have.add(k);
            add.push(k);
          }
        }
      }
      if (add.length) {
        t.headers = t.headers.filter(Boolean).length === 0 ? ["id", ...add.filter((k) => k !== "id")] : [...t.headers, ...add];
        t.sheet.getRange(t.headerRow, 1, 1, t.headers.length).setValues([t.headers]);
      }
    }
    const colKeys = t.headers.map((h) => (t.columns ? Object.entries(t.columns).find(([, header]) => header === h)?.[0] ?? null : h || null));
    const toRow = (obj: Record<string, unknown>, current?: unknown[]) =>
      colKeys.map((k, i) => (k === null ? current?.[i] ?? "" : k in obj ? toCell(obj[k], schema[k]) : current?.[i] ?? ""));
    const appends: unknown[][] = [];
    for (const [id, obj] of t.dirty) {
      const entry = t.rows.get(id)!;
      if (entry.row > 0) {
        const range = t.sheet.getRange(entry.row, 1, 1, t.headers.length);
        const current = t.columns ? range.getValues()[0] : undefined;
        range.setNumberFormat?.("@");
        range.setValues([toRow(obj, current)]);
      } else {
        entry.row = t.nextRow + appends.length;
        appends.push(toRow(obj));
      }
    }
    if (appends.length) {
      const range = t.sheet.getRange(t.nextRow, 1, appends.length, t.headers.length);
      range.setNumberFormat?.("@");
      range.setValues(appends);
      t.nextRow += appends.length;
    }
    const rowsToDelete = [...t.deleted].map((id) => t.rows.get(id)?.row ?? -1).filter((r) => r > 0).sort((a, b) => b - a);
    for (const r of rowsToDelete) {
      t.sheet.deleteRow(r);
      for (const e of t.rows.values()) if (e.row > r) e.row--;
      t.nextRow--;
    }
    for (const id of t.deleted) t.rows.delete(id);
    t.dirty.clear();
    t.deleted.clear();
  }
}

/** データソースの接続テスト（ZN-SET-10）：開けるか・見出しが想定どおりか */
export function testDataSource(open: OpenBook, ds: DataSource): { ok: boolean; headers: string[]; missing: string[]; message: string } {
  let book: BookLike;
  try {
    book = open(ds.spreadsheetId);
  } catch (e) {
    return { ok: false, headers: [], missing: [], message: `スプレッドシートを開けません（システムアカウントに共有されているか確認してください）：${e instanceof Error ? e.message : String(e)}` };
  }
  const sheet = book.getSheetByName(ds.sheetName);
  if (!sheet) return { ok: false, headers: [], missing: [], message: `タブ「${ds.sheetName}」が見つかりません` };
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(ds.headerRow || 1, 1, 1, lastCol).getValues()[0]!.map((h) => String(h).trim()).filter(Boolean) : [];
  const missing = Object.values(ds.columns).filter((h) => !headers.includes(h));
  const needsId = ["summary", "registry"].includes(ds.entity) ? false : !("id" in ds.columns);
  const ok = !missing.length && !needsId;
  return {
    ok,
    headers,
    missing,
    message: ok ? "接続できました" : needsId ? "「id」の列の対応を設定してください" : `見つからない列：${missing.join("、")}`,
  };
}

/** 集計などの表をタブに丸ごと書き直す */
export function writeTable(book: BookLike, tabName: string, rows: (string | number)[][]): void {
  const sheet = book.getSheetByName(tabName) ?? book.insertSheet(tabName);
  const width = Math.max(1, ...rows.map((r) => r.length));
  const old = sheet.getLastRow();
  const padded = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  if (padded.length) sheet.getRange(1, 1, padded.length, width).setValues(padded);
  for (let r = old; r > padded.length; r--) sheet.deleteRow(r);
  sheet.setFrozenRows?.(1);
}
