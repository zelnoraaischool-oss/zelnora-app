import { describe, expect, it } from "vitest";
import {
  addAdjustment,
  closeMonth,
  completeNextAction,
  createLead,
  customerDetail,
  dashboard,
  type Deal,
  type Delivery,
  finishDelivery,
  getSettings,
  handleApi,
  importWithLog,
  listCustomers,
  listRevenues,
  mergeCustomers,
  moveStage,
  newPlan,
  productFromTemplate,
  progressMatrix,
  recordPayment,
  recordSession,
  reassignOwner,
  reopenMonth,
  restoreVersion,
  revenueSummary,
  monthlySheet,
  runDailyJobs,
  salesBoard,
  saveForm,
  savePlan,
  saveProduct,
  testImport,
  updateCustomer,
  updateRevenue,
  listVersions,
  funnel,
  type Revenue,
  type ProgressItem,
  revisePlanPrice,
  getPlan,
} from "../src";
import { setup } from "./helpers";

function registerViaForm(env: ReturnType<typeof setup>, name: string, email: string, responseId: string, phone = "090-1111-2222") {
  return importWithLog(env.ctx, {
    formId: env.form.id,
    responseId,
    submittedAt: env.clock.now().toISOString(),
    answers: { q1: name, q2: email, q3: phone, q4: "転職したい", q5: "初心者" },
    questions: { q1: "氏名", q2: "メール" },
  });
}

describe("AESの業務フロー（5章）：リード→面談→契約→登録→提供→売上", () => {
  it("段階の種類に応じた自動処理が一通り動く", () => {
    const env = setup();
    const { ctx, sales1, product, plan } = env;
    // リード登録：担当と「初回連絡」の期限
    const { customer, deal } = createLead(ctx, sales1, { customer: { name: "山田 太郎", email: "Taro@Example.com", phone: "090-1111-2222" }, productId: product.id, source: "Instagram" });
    expect(deal.owner).toBe("sales1@example.com");
    expect(deal.nextAction).toEqual({ title: "初回連絡", due: "2026-10-01" });
    expect(customer.email).toBe("taro@example.com");

    // 必須項目が足りなければ移動できない
    expect(() => moveStage(ctx, sales1, deal.id, { stageId: "appo" })).toThrow(/連絡手段/);
    moveStage(ctx, sales1, deal.id, { stageId: "appo", fields: { contactMethod: "LINE" } });
    expect(() => moveStage(ctx, sales1, deal.id, { stageId: "meeting" })).toThrow(/面談日時/);
    const m = moveStage(ctx, sales1, deal.id, { stageId: "meeting", fields: { meetingAt: "2026-10-05" } });
    expect(m.deal.nextAction).toEqual({ title: "面談を行う", due: "2026-10-05" });
    expect(() => moveStage(ctx, sales1, deal.id, { stageId: "contract" })).toThrow(/プラン|金額|支払い方法/);
    const c = moveStage(ctx, sales1, deal.id, { stageId: "contract", planId: plan.id, paymentMethod: "銀行振込" });
    expect(c.deal.amount).toBe(30000);

    // 締結：契約・売上予定・登録フォームのURL
    const won = moveStage(ctx, sales1, deal.id, { stageId: "won" });
    expect(won.contract?.amountIncl).toBe(30000);
    expect(won.registrationUrl).toContain("forms/d/form-3m");
    const rev = ctx.store.all<Revenue>("revenues");
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ month: "2026-09", amountIncl: 30000, tax: 2727, status: "planned", owner: "sales1@example.com" });
    expect(env.notifier.sent.some((n) => n.kind === "deal.won" && n.to.includes("acc@example.com"))).toBe(true);

    // 登録フォーム：同じ人を見つけ、登録完了に進め、提供と進捗項目を作る
    const r = registerViaForm(env, "山田 太郎", "taro@example.com", "resp-1")!;
    expect(r.status).toBe("ok");
    expect(r.customer?.id).toBe(customer.id);
    expect(r.customer?.custom.purpose).toBe("転職したい");
    const d = ctx.store.get<Deal>("deals", deal.id)!;
    expect(d.stageId).toBe("registered");
    expect(r.delivery).toMatchObject({ startDate: "2026-09-30", endDate: "2026-12-29", status: "active", fields: { level: "初心者" } });
    expect(r.delivery!.owner).toBe("consult1@example.com"); // 担当数が少ない順
    const items = ctx.store.all<ProgressItem>("progress").filter((i) => i.deliveryId === r.delivery!.id).sort((a, b) => a.seq - b.seq);
    expect(items.map((i) => i.name).slice(0, 4)).toEqual(["初回受講設定", "初回受講", "2週目", "3週目"]);
    expect(items[items.length - 1]!.name).toBe("修了");
    expect(env.notifier.sent.some((n) => n.kind === "registration" && n.to.includes("consult1@example.com") && n.to.includes("sales1@example.com"))).toBe(true);

    // 同じ回答をもう一度取り込んでも重複しない。同じ人の再送信は更新のみ
    registerViaForm(env, "山田 太郎", "taro@example.com", "resp-1");
    registerViaForm(env, "山田 太郎", "taro@example.com", "resp-2");
    expect(ctx.store.all<Delivery>("deliveries")).toHaveLength(1);

    // 受講の記録：実施・宿題・次回の予定
    const consult = env.consult1;
    const setupItem = items[0]!;
    recordSession(ctx, consult, setupItem.id, { date: "2026-10-01", attendance: "attended", content: "初回の日程を決定", nextDate: "2026-10-04" });
    const first = ctx.store.get<ProgressItem>("progress", items[1]!.id)!;
    expect(first.dueDate).toBe("2026-10-04");
    const matrix = progressMatrix(ctx, consult, { productId: product.id, owner: "me" });
    expect(matrix.rows).toHaveLength(1);
    expect(Object.values(matrix.rows[0]!.cells).filter((c) => c.state === "done")).toHaveLength(1);
    // 他の提供担当には見えない
    expect(progressMatrix(ctx, env.consult2, { productId: product.id, owner: "all" }).rows).toHaveLength(0);

    // 顧客詳細の時系列
    const detail = customerDetail(ctx, env.owner, customer.id);
    const types = new Set(detail.timeline.map((t) => t.type));
    for (const t of ["stage", "contract", "registration", "progress", "revenue", "form"]) expect(types.has(t as never)).toBe(true);
    expect(detail.unpaid).toBe(30000);

    // 入金 → 月次締め → 締めた月は編集不可 → 返金は翌月に計上
    const revenue = listRevenues(ctx, env.accounting)[0]!;
    recordPayment(ctx, env.accounting, revenue.id, "2026-09-30");
    closeMonth(ctx, env.accounting, "2026-09");
    expect(() => updateRevenue(ctx, env.accounting, revenue.id, { amountIncl: 20000 })).toThrow(/締め済み/);
    const refund = addAdjustment(ctx, env.accounting, revenue.id, { kind: "refund", amountIncl: 10000, month: "2026-09", note: "一部返金" });
    expect(refund).toMatchObject({ month: "2026-10", amountIncl: -10000, parentId: revenue.id });
    expect(() => reopenMonth(ctx, env.accounting, "2026-09", "修正")).toThrow(/オーナー/);
    expect(() => reopenMonth(ctx, env.owner, "2026-09", "")).toThrow(/理由/);
    reopenMonth(ctx, env.owner, "2026-09", "入力ミスの修正");

    // 月次集計と、管理シートに書き出す表
    const sum = revenueSummary(ctx, env.accounting, { from: "2026-09", to: "2026-10", groupBy: "plan" });
    expect(sum.totals).toEqual({ "2026-09": 30000, "2026-10": -10000 });
    const sheet = monthlySheet(ctx);
    expect(sheet[0]).toContain("計上月");
    expect(sheet.length).toBe(3);

    // ダッシュボード
    const dash = dashboard(ctx, sales1, { period: "this_month" });
    expect(dash.sales.wonCount).toBe(1);
    expect(dash.sales.wonAmount).toBe(30000);
    const f = funnel(ctx, env.owner, { productId: product.id });
    expect(f.stages.find((s) => s.stageId === "meeting")?.count).toBe(1);
  });
});

describe("例外の扱い（5.4）", () => {
  it("契約より先にフォームが届いたら保留し、商談がなければ商談なしの登録として記録する", () => {
    const env = setup();
    const { ctx, sales1, product } = env;
    createLead(ctx, sales1, { customer: { name: "先走 花子", email: "early@example.com" }, productId: product.id });
    const r1 = registerViaForm(env, "先走 花子", "early@example.com", "r-early")!;
    expect(r1.status).toBe("pending_before_contract");
    expect(ctx.store.all<Delivery>("deliveries")).toHaveLength(0);

    const r2 = registerViaForm(env, "飛込 次郎", "walkin@example.com", "r-walkin", "080-9999-0000")!;
    expect(r2.status).toBe("pending_no_deal");
    expect(r2.delivery).not.toBeNull();
    expect(env.notifier.sent.some((n) => n.kind === "registration.no_deal" && n.to.includes("mgr@example.com"))).toBe(true);
  });

  it("候補が複数あれば統合待ちにする。取り込みに失敗した回答は記録される", () => {
    const env = setup();
    const { ctx, owner } = env;
    ctx.store.put("customers", { id: "c1", name: "A", kana: "", email: "dup@example.com", phone: "", company: "", source: "", status: "lead", tags: [], salesOwner: null, note: "", custom: {}, createdAt: "", updatedAt: "", version: 1 });
    ctx.store.put("customers", { id: "c2", name: "B", kana: "", email: "", phone: "090-1111-2222", company: "", source: "", status: "lead", tags: [], salesOwner: null, note: "", custom: {}, createdAt: "", updatedAt: "", version: 1 });
    const r = registerViaForm(env, "A", "dup@example.com", "r-dup")!;
    expect(r.status).toBe("pending_merge");
    expect(importWithLog(ctx, { formId: "unknown", responseId: "x", submittedAt: "", answers: {} })).toBeNull();
    const failed = ctx.store.all<{ result: string }>("imports").filter((l) => l.result === "failed");
    expect(failed).toHaveLength(1);
    // テスト取り込みは実データを変えない
    const before = ctx.store.all("customers").length;
    const t = testImport(ctx, owner, { formId: env.form.id, responseId: "test", submittedAt: "", answers: { q1: "テスト", q2: "test@example.com" } });
    expect(t.ok).toBe(true);
    expect(t.changes.length).toBeGreaterThan(0);
    expect(ctx.store.all("customers").length).toBe(before);
  });
});

describe("権限（4章）", () => {
  it("営業担当は自分の商談と顧客だけ、閲覧者は連絡先が伏せられる", () => {
    const env = setup();
    const { ctx, product } = env;
    createLead(ctx, env.sales1, { customer: { name: "一の客", email: "one@example.com", phone: "090-1234-5678" }, productId: product.id });
    createLead(ctx, env.sales2, { customer: { name: "二の客", email: "two@example.com" }, productId: product.id });
    expect(listCustomers(ctx, env.sales1).map((c) => c.name)).toEqual(["一の客"]);
    expect(listCustomers(ctx, env.manager)).toHaveLength(2);
    const v = listCustomers(ctx, env.viewer).find((c) => c.name === "一の客")!;
    expect(v.phone).toBe("090-****-5678");
    expect(v.email).toBe("o***@example.com");
    const board = salesBoard(ctx, env.sales1, { productId: product.id, owner: "all" });
    expect(board.columns.flatMap((c) => c.cards)).toHaveLength(1);
    const other = listCustomers(ctx, env.owner).find((c) => c.name === "二の客")!;
    expect(() => customerDetail(ctx, env.sales1, other.id)).toThrow(/権限/);
    // 営業担当は、他の営業担当の顧客の提供も見えない
    const d2 = ctx.store.all<Deal>("deals").find((d) => d.customerId === other.id)!;
    moveStage(ctx, env.owner, d2.id, { stageId: "contract", planId: env.plan.id, paymentMethod: "振込", fields: { contactMethod: "電話", meetingAt: "2026-10-01" } });
    moveStage(ctx, env.owner, d2.id, { stageId: "registered" });
    expect(progressMatrix(ctx, env.sales1, { productId: product.id, owner: "all" }).rows).toHaveLength(0);
    expect(progressMatrix(ctx, env.sales2, { productId: product.id, owner: "all" }).rows).toHaveLength(1);
    expect(() => listRevenues(ctx, env.viewer)).toThrow(/権限/);
    // 担当外の商材は見えない
    const other2 = productFromTemplate(ctx, "oneoff", "Web制作");
    saveProduct(ctx, env.owner, other2);
    expect(() => createLead(ctx, env.sales1, { customer: { name: "x" }, productId: other2.id })).toThrow(/担当外/);
  });

  it("担当の一括付け替えと、ログインの制限", () => {
    const env = setup();
    const { ctx, product } = env;
    createLead(ctx, env.sales1, { customer: { name: "引継 太郎", email: "h@example.com" }, productId: product.id });
    const r = reassignOwner(ctx, env.manager, { from: "sales1@example.com", to: "sales2@example.com", deals: true, deliveries: true, customers: true });
    expect(r.deals).toBe(1);
    expect(listCustomers(ctx, env.sales2).map((c) => c.name)).toEqual(["引継 太郎"]);
    expect(ctx.store.all<{ action: string }>("audit").some((a) => a.action === "owner.reassign")).toBe(true);
    expect(handleApi(ctx, "stranger@gmail.com", { action: "session" })).toMatchObject({ ok: false, code: "forbidden" });
    const s = getSettings(ctx);
    ctx.store.putSettings({ ...s, allowedDomains: ["example.co.jp"] });
    const res = handleApi(ctx, "new@example.co.jp", { action: "session" });
    expect(res.ok && (res.data as { user: { role: string } }).user.role).toBe("viewer");
  });
});

describe("顧客の重複と更新の衝突", () => {
  it("統合で商談・提供を付け替え、統合前の状態を監査ログに残す", () => {
    const env = setup();
    const { ctx, product } = env;
    const a = createLead(ctx, env.sales1, { customer: { name: "山田太郎", email: "a@example.com", phone: "090-5555-6666" }, productId: product.id });
    const b = createLead(ctx, env.sales1, { customer: { name: "山田 太郎", email: "a2@example.com", phone: "09055556666" }, productId: product.id });
    const merged = mergeCustomers(ctx, env.owner, a.customer.id, b.customer.id, { email: "secondary" });
    expect(merged.email).toBe("a2@example.com");
    expect(ctx.store.get<Deal>("deals", b.deal.id)!.customerId).toBe(a.customer.id);
    expect(listCustomers(ctx, env.owner)).toHaveLength(1);
    const log = ctx.store.all<{ action: string; detail: string }>("audit").find((x) => x.action === "customer.merge")!;
    expect(JSON.parse(log.detail).before.secondary.email).toBe("a2@example.com");
  });

  it("他の人の更新と重なったら衝突にする", () => {
    const env = setup();
    const { customer } = createLead(env.ctx, env.sales1, { customer: { name: "衝突", email: "c@example.com" }, productId: env.product.id });
    updateCustomer(env.ctx, env.sales1, customer.id, { note: "1" }, 1);
    expect(() => updateCustomer(env.ctx, env.sales1, customer.id, { note: "2" }, 1)).toThrow(/他の人/);
  });
});

describe("汎用性（2章）：2つ目の商材をコード変更なしで運用できる", () => {
  it("コンサル型の商材を設定だけで追加し、月額で計上し、解約で止める", () => {
    const env = setup();
    const { ctx, owner } = env;
    const p = productFromTemplate(ctx, "consulting", "DX支援");
    saveProduct(ctx, owner, p);
    const plan = newPlan(ctx, p.id, { name: "月額プラン", priceBasis: "incl", priceIncl: 110000, priceExcl: 100000, duration: { value: 6, unit: "month" } });
    savePlan(ctx, owner, plan);
    saveForm(ctx, owner, { ...env.form, id: "form-dx", productId: p.id, planId: plan.id, name: "キックオフ情報" });
    const { deal } = createLead(ctx, owner, { customer: { name: "株式会社サンプル", email: "dx@example.com", company: "株式会社サンプル" }, productId: p.id });
    moveStage(ctx, owner, deal.id, { stageId: "hearing", fields: { meetingAt: "2026-10-02" } });
    moveStage(ctx, owner, deal.id, { stageId: "contract", planId: plan.id, paymentMethod: "請求書払い" });
    moveStage(ctx, owner, deal.id, { stageId: "won" });
    // 計上の基準が「提供開始日」のため、この時点では売上予定はまだない
    expect(ctx.store.all<Revenue>("revenues").filter((r) => r.productId === p.id)).toHaveLength(0);
    env.clock.set("2026-10-15T01:00:00.000Z");
    const r = importWithLog(ctx, { formId: "form-dx", responseId: "dx1", submittedAt: "", answers: { q1: "株式会社サンプル", q2: "dx@example.com" } })!;
    expect(ctx.store.get<Deal>("deals", deal.id)!.stageId).toBe("kickoff");
    const revs = ctx.store.all<Revenue>("revenues").filter((x) => x.productId === p.id);
    expect(revs.map((x) => x.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(revs.every((x) => x.amountIncl === 110000)).toBe(true);
    const items = ctx.store.all<ProgressItem>("progress").filter((i) => i.deliveryId === r.delivery!.id).sort((a, b) => a.seq - b.seq);
    expect(items[0]!.name).toBe("キックオフ");
    expect(items[1]!.name).toBe("月次定例（1回目）");
    // 12月に解約：1月以降の月額を止める
    finishDelivery(ctx, owner, r.delivery!.id, { status: "canceled", date: "2026-12-10", reason: "予算削減" });
    const after = ctx.store.all<Revenue>("revenues").filter((x) => x.productId === p.id && x.status !== "canceled");
    expect(after.map((x) => x.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
});

describe("設定", () => {
  it("価格改定は改定日以降の契約だけに適用される", () => {
    const env = setup();
    const { ctx, owner, plan, product } = env;
    revisePlanPrice(ctx, owner, plan.id, "2026-11-01", 36364, 40000);
    expect(getPlan(ctx, plan.id).priceIncl).toBe(30000);
    const { deal } = createLead(ctx, owner, { customer: { name: "改定前", email: "p1@example.com" }, productId: product.id, planId: plan.id });
    expect(deal.amount).toBe(30000);
    env.clock.set("2026-11-02T01:00:00.000Z");
    const { deal: d2 } = createLead(ctx, owner, { customer: { name: "改定後", email: "p2@example.com" }, productId: product.id, planId: plan.id });
    expect(d2.amount).toBe(40000);
    // 価格の直接変更は改定の手順を経る必要がある
    expect(() => savePlan(ctx, owner, { ...getPlan(ctx, plan.id), priceIncl: 1 })).toThrow(/価格の改定/);
  });

  it("設定の変更は版として残り、任意の版に戻せる。停止中のプランは選べない", () => {
    const env = setup();
    const { ctx, owner, plan, product } = env;
    const v0 = getSettings(ctx).version;
    savePlan(ctx, owner, { ...plan, status: "stopped" });
    expect(() => createLead(ctx, owner, { customer: { name: "x" }, productId: product.id, planId: plan.id })).toThrow(/停止中/);
    expect(listVersions(ctx)[0]!.version).toBe(v0 + 1);
    restoreVersion(ctx, owner, v0);
    expect(getPlan(ctx, plan.id).status).toBe("active");
    expect(() => savePlan(ctx, env.sales1, plan)).toThrow(/権限/);
  });
});

describe("毎日の自動処理と次のアクション", () => {
  it("予定日を過ぎた進捗を知らせ、月末に締めを依頼する", () => {
    const env = setup();
    const { ctx, owner, product, plan } = env;
    const { deal } = createLead(ctx, owner, { customer: { name: "遅延 太郎", email: "late@example.com" }, productId: product.id, planId: plan.id });
    expect(() => completeNextAction(ctx, owner, deal.id, null)).toThrow(/次のアクション/);
    completeNextAction(ctx, owner, deal.id, { title: "資料送付", due: "2026-10-03" }, "電話した");
    moveStage(ctx, owner, deal.id, { stageId: "contract", planId: plan.id, paymentMethod: "カード", fields: { contactMethod: "電話", meetingAt: "2026-10-01" } });
    const w = moveStage(ctx, owner, deal.id, { stageId: "registered" });
    expect(w.delivery).toBeDefined();
    env.clock.set("2026-10-03T01:00:00.000Z"); // 初回受講設定の予定日（10/2）の翌日
    const r = runDailyJobs(ctx);
    expect(r.overdue).toBeGreaterThan(0);
    env.clock.set("2026-10-31T01:00:00.000Z");
    expect(runDailyJobs(ctx).closingRequest).toBe(true);
    expect(env.notifier.sent.some((n) => n.kind === "month.closing" && n.to.includes("acc@example.com"))).toBe(true);
  });
});

describe("リードの登録経路（ZN-SALES-08）：問い合わせフォームとCSV", () => {
  it("問い合わせフォームの回答からリードを登録し、流入経路を記録する", async () => {
    const env = setup();
    const { ctx, owner, product } = env;
    const { saveForm: sf } = await import("../src");
    sf(ctx, owner, { ...env.form, id: "inquiry", purpose: "lead", planId: "", name: "無料相談の申込", mapping: { a: "customer.name", b: "customer.email" } });
    const r = importWithLog(ctx, { formId: "inquiry", responseId: "i1", submittedAt: "", answers: { a: "問合 花子", b: "toi@example.com" } })!;
    expect(r.status).toBe("ok");
    const d = ctx.store.get<Deal>("deals", r.dealId!)!;
    expect(d).toMatchObject({ productId: product.id, stageId: "lead", source: "フォーム：無料相談の申込" });
    expect(d.nextAction?.title).toBe("初回連絡");
    expect(ctx.store.all<Delivery>("deliveries")).toHaveLength(0);
  });

  it("CSVは取り込み前にプレビューと重複の確認をし、既存の人はとばせる", async () => {
    const env = setup();
    const { ctx, sales1, product } = env;
    const { importLeadsCsv } = await import("../src");
    createLead(ctx, sales1, { customer: { name: "既存 一郎", email: "exists@example.com" }, productId: product.id });
    const rows = [
      { name: "新規 太郎", email: "new1@example.com", source: "展示会" },
      { name: "既存 一郎", email: "EXISTS@example.com" },
      { name: "", email: "bad" },
    ];
    const preview = importLeadsCsv(ctx, sales1, { productId: product.id, rows, source: "CSV", dryRun: true, skipExisting: true });
    expect(preview.preview.map((p) => [!!p.existing, p.error])).toEqual([[false, null], [true, null], [false, "氏名がありません"]]);
    expect(ctx.store.all<Deal>("deals")).toHaveLength(1);
    const res = importLeadsCsv(ctx, sales1, { productId: product.id, rows, source: "CSV", dryRun: false, skipExisting: true });
    expect(res).toMatchObject({ imported: 1, skipped: 2 });
    const d = ctx.store.all<Deal>("deals").find((x) => x.source === "展示会")!;
    expect(d.owner).toBe("sales1@example.com");
  });
});
