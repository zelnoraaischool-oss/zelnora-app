import { bootstrapOwner, createCtx, createLead, type DataSource, moveStage, newPlan, productFromTemplate, saveDataSource, savePlan, saveProduct, type Customer } from "@zelnora/core";
import { describe, expect, it } from "vitest";
import { SheetsStore, testDataSource } from "../src/sheets-store";
import { FakeBook } from "./fake-sheets";

function books() {
  const map = new Map<string, FakeBook>();
  const open = (id: string) => {
    let b = map.get(id);
    if (!b) {
      if (id.startsWith("missing")) throw new Error("not found");
      b = new FakeBook(id);
      map.set(id, b);
    }
    return b;
  };
  return { map, open };
}

describe("SheetsStore（スプレッドシートを正本にする）", () => {
  it("エンティティごとのタブに書き込み、読み直しても同じ値になる", () => {
    const { open, map } = books();
    const store = new SheetsStore(open, "db");
    const ctx = createCtx(store);
    const owner = bootstrapOwner(ctx, "owner@example.com", "オーナー");
    const p = productFromTemplate(ctx, "school", "商材A");
    saveProduct(ctx, owner, p);
    const plan = newPlan(ctx, p.id, { name: "プランA", priceIncl: 30000, priceExcl: 27273 });
    savePlan(ctx, owner, plan);
    const { deal, customer } = createLead(ctx, owner, { customer: { name: "山田 太郎", email: "t@example.com", tags: ["A", "B"] }, productId: p.id });
    moveStage(ctx, owner, deal.id, { stageId: "contract", planId: plan.id, paymentMethod: "振込", fields: { contactMethod: "電話", meetingAt: "2026-10-01" } });
    store.flush();

    const db = map.get("db")!;
    expect([...db.sheets.keys()]).toEqual(expect.arrayContaining(["_settings", "users", "customers", "deals", "activities", "audit", "settingsVersions"]));
    const customers = db.sheets.get("customers")!;
    expect(customers.data[0]![0]).toBe("id");

    // 新しいインスタンス（次のリクエスト）で読み直す
    const store2 = new SheetsStore(open, "db");
    const c2 = store2.get<Customer>("customers", customer.id)!;
    expect(c2).toMatchObject({ name: "山田 太郎", tags: ["A", "B"], version: customer.version });
    const d2 = store2.get<typeof deal>("deals", deal.id)!;
    expect(d2.amount).toBe(30000);
    expect(d2.nextAction?.title).toBe("締結を確認する");
    expect(store2.getSettings()?.products[0]?.name).toBe("商材A");
    expect(store2.get("users", "owner@example.com")).toMatchObject({ role: "owner" });

    // 更新は同じ行、削除は行を詰める
    store2.put("customers", { ...c2, name: "山田 花子" });
    store2.flush();
    expect(customers.data.filter((r) => r[0] === customer.id)).toHaveLength(1);
    store2.remove("customers", customer.id);
    store2.flush();
    expect(new SheetsStore(open, "db").get("customers", customer.id)).toBeNull();
  });

  it("シートが日付に変換した値も文字列の日付として読める", () => {
    const { open, map } = books();
    const store = new SheetsStore(open, "db");
    store.put("closings", { id: "2026-09", month: "2026-09", closedAt: "2026-10-01T00:00:00.000Z" } as never);
    store.flush();
    map.get("db")!.sheets.get("closings")!.data[1]![2] = new Date("2026-09-30T15:00:00.000Z");
    const r = new SheetsStore(open, "db").get<{ closedAt: string }>("closings", "2026-09")!;
    expect(r.closedAt).toBe("2026-10-01");
  });

  it("既存のシートを登録簿の列の対応で読み書きし、対応のない項目は影のタブに残す", () => {
    const { open, map } = books();
    const legacy = open("legacy");
    const sheet = legacy.insertSheet("顧客管理");
    sheet.getRange(1, 1, 3, 4).setValues([
      ["管理番号", "お名前", "メール", "備考（手入力）"],
      ["c-1", "既存 太郎", "old@example.com", "紙の申込書あり"],
      ["", "IDなし", "noid@example.com", ""],
    ]);
    const store = new SheetsStore(open, "db");
    const ctx = createCtx(store);
    const owner = bootstrapOwner(ctx, "owner@example.com", "オーナー");
    const ds: DataSource = { id: "ds1", name: "顧客管理シート", spreadsheetId: "legacy", entity: "customers", sheetName: "顧客管理", headerRow: 1, columns: { id: "管理番号", name: "お名前", email: "メール" }, status: "ok", lastCheckedAt: null, message: "" };
    saveDataSource(ctx, owner, ds);
    store.flush();

    const s2 = new SheetsStore(open, "db");
    const all = s2.all<Customer>("customers");
    expect(all.map((c) => c.name)).toEqual(["既存 太郎"]);
    s2.put("customers", { ...all[0]!, name: "既存 次郎", tags: ["移行"], version: 2 });
    s2.flush();
    expect(sheet.data[1]).toEqual(["c-1", "既存 次郎", "old@example.com", "紙の申込書あり"]);
    expect(map.get("db")!.sheets.has("_ext_customers")).toBe(true);
    const s3 = new SheetsStore(open, "db");
    expect(s3.get<Customer>("customers", "c-1")).toMatchObject({ name: "既存 次郎", tags: ["移行"], version: 2 });

    // 見出しが変わったら書き込みを止める（ZN-SET-11）
    sheet.data[0]![1] = "氏名";
    const problems: string[] = [];
    const s4 = new SheetsStore(open, "db", (_d, m) => problems.push(m));
    expect(() => s4.put("customers", { id: "c-2", name: "x" } as never)).toThrow(/見出し/);
    expect(problems[0]).toMatch(/お名前/);
    expect(testDataSource(open, ds)).toMatchObject({ ok: false, missing: ["お名前"] });
    expect(testDataSource(open, { ...ds, spreadsheetId: "missing-1" }).message).toMatch(/開けません/);
  });

  it("大きな設定も分割して保存できる", () => {
    const { open } = books();
    const store = new SheetsStore(open, "db");
    const ctx = createCtx(store);
    const owner = bootstrapOwner(ctx, "owner@example.com", "オーナー");
    const p = productFromTemplate(ctx, "school", "大きな商材");
    p.activityTemplates = Array.from({ length: 400 }, (_, i) => ({ title: `文面${i}`, body: "あ".repeat(300) }));
    saveProduct(ctx, owner, p);
    store.flush();
    expect(new SheetsStore(open, "db").getSettings()?.products[0]?.activityTemplates).toHaveLength(400);
  });
});
