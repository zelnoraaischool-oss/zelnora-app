// デモモード：Apps Script の代わりに、同じドメインロジック（@zelnora/core）をブラウザ内で動かす
import {
  type ApiRequest,
  type ApiResponse,
  addDays,
  addMonthToMonth,
  bootstrapOwner,
  closeMonth,
  CollectingNotifier,
  createCtx,
  createLead,
  type Ctx,
  getSettings,
  handleApi,
  type Handler,
  importWithLog,
  MemoryStore,
  monthOf,
  moveStage,
  newPlan,
  productFromTemplate,
  recordPayment,
  recordSession,
  saveForm,
  savePlan,
  saveProduct,
  saveUser,
  systemClock,
  today,
  updateSettings,
  type ProgressItem,
  type Revenue,
  type Settings,
} from "@zelnora/core";

const KEY = "zelnora-demo-v1";

class DemoStore extends MemoryStore {
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.snapshot()));
    } catch {
      // 保存できない環境ではメモリ上だけで動く
    }
  }
}

function load(): DemoStore | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return new DemoStore(JSON.parse(raw) as { tables: Record<string, unknown[]>; settings: Settings });
  } catch {
    return null;
  }
}

/** デモ用のサンプルデータ */
export function seedDemo(store: MemoryStore): void {
  const ctx = createCtx(store, { clock: systemClock, notifier: new CollectingNotifier(), prefillUrl: (formId, v) => `https://docs.google.com/forms/d/${formId}/viewform?usp=pp_url&name=${encodeURIComponent(v.name ?? "")}` });
  const owner = bootstrapOwner(ctx, "owner@demo.example", "オーナー（デモ）");
  updateSettings(ctx, owner, (s) => {
    s.organizationName = "サンプル事業者";
    s.allowedDomains = ["demo.example"];
  }, "デモの初期設定", { permission: "settings.sources" });
  const school = productFromTemplate(ctx, "school", "スクール（デモ）");
  saveProduct(ctx, owner, school);
  const planA = newPlan(ctx, school.id, { name: "スタンダード（3か月）", priceBasis: "incl", priceIncl: 330000, priceExcl: 300000, duration: { value: 3, unit: "month" }, description: "毎週1回の個別指導" });
  const planB = newPlan(ctx, school.id, { name: "ライト（1か月）", priceBasis: "incl", priceIncl: 110000, priceExcl: 100000, duration: { value: 1, unit: "month" }, payment: { type: "lump", count: 1, intervalMonths: 1 } });
  const planC = newPlan(ctx, school.id, { name: "プレミアム（6か月・分割）", priceBasis: "incl", priceIncl: 660000, priceExcl: 600000, duration: { value: 6, unit: "month" }, payment: { type: "installment", count: 3, intervalMonths: 1 }, revenueRule: "installment" });
  for (const p of [planA, planB, planC]) savePlan(ctx, owner, p);
  saveForm(ctx, owner, {
    id: "demo-form-standard",
    productId: school.id,
    planId: planA.id,
    name: "登録フォーム（スタンダード）",
    responseSpreadsheetId: "",
    responseSheetName: "スタンダード",
    mapping: { "1001": "customer.name", "1002": "customer.email", "1003": "customer.phone", "1004": "customer.custom.purpose" },
    matchBy: ["email", "phone"],
    actions: { advanceStage: true, createDelivery: true, notify: true },
    active: true,
  });
  const consulting = productFromTemplate(ctx, "consulting", "法人支援（デモ）");
  saveProduct(ctx, owner, consulting);
  const planD = newPlan(ctx, consulting.id, { name: "月額支援", priceBasis: "excl", priceIncl: 220000, priceExcl: 200000, duration: { value: 6, unit: "month" } });
  savePlan(ctx, owner, planD);

  const u = (email: string, name: string, role: Parameters<typeof saveUser>[2]["role"], productIds: string[], capacity: number | null = null) =>
    saveUser(ctx, owner, { email, name, role, productIds, active: true, capacity });
  const sales1 = u("sato@demo.example", "佐藤（営業）", "sales", [school.id, consulting.id]);
  const sales2 = u("suzuki@demo.example", "鈴木（営業）", "sales", [school.id]);
  u("takahashi@demo.example", "高橋（提供担当）", "delivery", [school.id], 15);
  u("tanaka@demo.example", "田中（提供担当）", "delivery", [school.id, consulting.id], 15);
  u("ito@demo.example", "伊藤（経理）", "accounting", []);
  u("watanabe@demo.example", "渡辺（マネージャー）", "manager", [school.id, consulting.id]);
  u("yamamoto@demo.example", "山本（閲覧者）", "viewer", [school.id]);

  const t = today(ctx.clock);
  const people = [
    ["青木 優", "aoki@example.com", "Instagram"],
    ["石井 翔", "ishii@example.com", "紹介"],
    ["上田 美咲", "ueda@example.com", "広告"],
    ["遠藤 健", "endo@example.com", "Instagram"],
    ["小川 彩", "ogawa@example.com", "セミナー"],
    ["加藤 大輔", "kato@example.com", "紹介"],
    ["木村 さくら", "kimura@example.com", "広告"],
    ["清水 陽介", "shimizu@example.com", "YouTube"],
    ["中村 恵", "nakamura@example.com", "Instagram"],
    ["林 拓海", "hayashi@example.com", "セミナー"],
  ] as const;
  const deals = people.map(([name, email, source], i) =>
    createLead(ctx, i % 2 ? sales2 : sales1, { customer: { name, email, phone: `090-${1000 + i}-${2000 + i}`, source }, productId: school.id, source }).deal,
  );
  const mv = (i: number, stageId: string, extra: Parameters<typeof moveStage>[3] extends infer M ? Partial<M> : never = {}) =>
    moveStage(ctx, owner, deals[i]!.id, { stageId, ...extra } as Parameters<typeof moveStage>[3]);
  mv(1, "appo", { fields: { contactMethod: "LINE" } });
  mv(2, "meeting", { fields: { contactMethod: "電話", meetingAt: addDays(t, 2) } });
  mv(3, "meeting", { fields: { contactMethod: "電話", meetingAt: addDays(t, -1) } });
  mv(4, "contract", { planId: planB.id, paymentMethod: "クレジットカード", fields: { contactMethod: "メール", meetingAt: addDays(t, -5) } });
  mv(5, "lost", { fields: { lostReason: "価格" } });
  for (const [i, plan] of [[6, planA], [7, planA], [8, planC], [9, planB]] as const) {
    mv(i, "contract", { planId: plan.id, paymentMethod: i === 8 ? "分割（銀行振込）" : "銀行振込", fields: { contactMethod: "電話", meetingAt: addDays(t, -20) } });
    mv(i, "won", { signedAt: addDays(t, -10 - i) });
  }
  // 登録フォームの回答（2名）：提供と進捗項目が自動で作られる
  for (const i of [6, 7]) {
    importWithLog(ctx, { formId: "demo-form-standard", responseId: `demo-${i}`, submittedAt: new Date().toISOString(), answers: { "1001": people[i]![0], "1002": people[i]![1], "1004": "スキルアップ" } });
  }
  mv(8, "registered");
  // セッションの記録
  const items = store.all<ProgressItem>("progress").sort((a, b) => a.seq - b.seq);
  const first = items.find((i) => i.name === items[0]?.name);
  if (first) recordSession(ctx, owner, first.id, { date: t, attendance: "attended", content: "初回の日程を決定", nextDate: addDays(t, 3) });
  // 入金と、先月の締め
  const rev = store.all<Revenue>("revenues").filter((r) => r.kind === "sale").sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  if (rev[0]) recordPayment(ctx, owner, rev[0].id, t);
  const lastMonth = addMonthToMonth(monthOf(t), -1);
  if (!store.all<Revenue>("revenues").some((r) => r.month === lastMonth)) closeMonth(ctx, owner, lastMonth);

  // 法人支援の商談
  createLead(ctx, sales1, { customer: { name: "株式会社サンプル商事", email: "info@sample-shoji.example", company: "株式会社サンプル商事" }, productId: consulting.id, source: "問い合わせ" });
  void getSettings(ctx);
}

let state: { store: DemoStore; ctx: Ctx } | null = null;

function ensure(): { store: DemoStore; ctx: Ctx } {
  if (state) return state;
  let store = load();
  if (!store) {
    store = new DemoStore();
    seedDemo(store);
    store.save();
  }
  state = { store, ctx: createCtx(store, { clock: systemClock, notifier: new CollectingNotifier(), prefillUrl: (formId, v) => `https://docs.google.com/forms/d/${formId}/viewform?name=${encodeURIComponent(v.name ?? "")}` }) };
  return state;
}

export function resetDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 無視
  }
  state = null;
}

export function demoUsers(): { email: string; name: string; role: string }[] {
  return ensure().store.all<{ email: string; name: string; role: string; active: boolean }>("users").filter((u) => u.active);
}

/** Apps Script でだけ動く操作の、デモ用の代わり */
const demoHandlers: Record<string, Handler> = {
  "forms.inspect": (_ctx, _user, p) => ({
    id: String(p.formId),
    title: "（デモ）登録フォーム",
    publishedUrl: `https://docs.google.com/forms/d/${String(p.formId)}/viewform`,
    destinationId: "",
    items: [
      { id: "1001", title: "お名前", type: "TEXT" },
      { id: "1002", title: "メールアドレス", type: "TEXT" },
      { id: "1003", title: "電話番号", type: "TEXT" },
      { id: "1004", title: "申し込みの目的", type: "PARAGRAPH_TEXT" },
      { id: "1005", title: "ご職業", type: "MULTIPLE_CHOICE" },
    ],
  }),
  "dataSources.test": (_ctx, _user, p) => ({ ok: true, headers: Object.values((p.dataSource?.columns ?? {}) as Record<string, string>), missing: [], message: "（デモ）接続できたものとして扱います" }),
  "forms.installTriggers": () => ({ installed: 0 }),
  "summary.export": () => true,
};

export async function demoCall(email: string, req: ApiRequest): Promise<ApiResponse> {
  const { store, ctx } = ensure();
  const res = handleApi(ctx, email, req, demoHandlers);
  store.save();
  // 画面の反応を実際の通信に近づける
  await new Promise((r) => setTimeout(r, 60));
  return JSON.parse(JSON.stringify(res)) as ApiResponse;
}
