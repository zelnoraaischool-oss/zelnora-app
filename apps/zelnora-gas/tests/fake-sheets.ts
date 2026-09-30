import type { BookLike, RangeLike, SheetLike } from "../src/sheets-store";

/** テスト用のスプレッドシート（メモリ上の2次元配列） */
export class FakeSheet implements SheetLike {
  data: unknown[][] = [];
  calls = 0;
  constructor(private readonly name: string) {}
  getName() {
    return this.name;
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if ((this.data[r - 1] ?? []).some((v) => v !== "" && v !== undefined && v !== null)) return r;
    return 0;
  }
  getLastColumn() {
    return Math.max(0, ...this.data.map((r) => {
      for (let c = r.length; c > 0; c--) if (r[c - 1] !== "" && r[c - 1] !== undefined) return c;
      return 0;
    }));
  }
  getRange(row: number, column: number, numRows = 1, numColumns = 1): RangeLike {
    this.calls++;
    return {
      getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numColumns }, (_, j) => this.data[row - 1 + i]?.[column - 1 + j] ?? "")),
      setValues: (values: unknown[][]) => {
        values.forEach((r, i) => {
          const rr = (this.data[row - 1 + i] ??= []);
          r.forEach((v, j) => {
            for (let k = rr.length; k < column - 1 + j; k++) rr[k] = "";
            rr[column - 1 + j] = v;
          });
        });
        for (let k = 0; k < this.data.length; k++) this.data[k] ??= [];
      },
      setNumberFormat: () => undefined,
    };
  }
  deleteRow(row: number) {
    this.data.splice(row - 1, 1);
  }
}

export class FakeBook implements BookLike {
  sheets = new Map<string, FakeSheet>();
  constructor(private readonly id: string) {}
  getId() {
    return this.id;
  }
  getSheetByName(name: string) {
    return this.sheets.get(name) ?? null;
  }
  insertSheet(name: string) {
    const s = new FakeSheet(name);
    this.sheets.set(name, s);
    return s;
  }
}
