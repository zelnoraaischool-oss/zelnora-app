import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 確定版PDFの保存先。上書き・削除のメソッドは意図的に持たない */
export interface DocumentStorage {
  /** 新規作成のみ。同じパスが存在すればエラー */
  create(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(objectPath: string): Promise<Uint8Array>;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  private resolve(p: string): string {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("invalid path");
    return full;
  }

  async create(objectPath: string, bytes: Uint8Array): Promise<void> {
    const full = this.resolve(objectPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx", mode: 0o444 });
  }

  async read(objectPath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(objectPath)));
  }
}

export class SupabaseDocumentStorage implements DocumentStorage {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly bucket = "documents",
  ) {}

  private endpoint(objectPath: string) {
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  async create(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await fetch(this.endpoint(objectPath), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        "Content-Type": contentType,
        "x-upsert": "false",
        "cache-control": "no-store",
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`ストレージへの保存に失敗しました（HTTP ${res.status}）: ${await res.text()}`);
  }

  async read(objectPath: string): Promise<Uint8Array> {
    const res = await fetch(this.endpoint(objectPath), {
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ストレージからの読み込みに失敗しました（HTTP ${res.status}）`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
