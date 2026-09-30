import {
  bootstrapOwner,
  CollectingNotifier,
  createCtx,
  type Ctx,
  MemoryStore,
  newPlan,
  productFromTemplate,
  saveForm,
  savePlan,
  saveProduct,
  saveUser,
  type Clock,
  type FormMapping,
  type User,
} from "../src";

export class TestClock implements Clock {
  constructor(private iso: string) {}
  now() {
    return new Date(this.iso);
  }
  set(iso: string) {
    this.iso = iso;
  }
}

export function setup() {
  const clock = new TestClock("2026-09-30T01:00:00.000Z"); // 2026-09-30 10:00 JST
  const notifier = new CollectingNotifier();
  const store = new MemoryStore();
  const ctx: Ctx = createCtx(store, { clock, notifier, prefillUrl: (formId, v) => `https://docs.google.com/forms/d/${formId}/viewform?name=${encodeURIComponent(v.name ?? "")}` });
  const owner = bootstrapOwner(ctx, "owner@example.com", "オーナー");
  const product = productFromTemplate(ctx, "school", "AES");
  saveProduct(ctx, owner, product);
  const plan = newPlan(ctx, product.id, { name: "3か月プラン", priceBasis: "incl", priceIncl: 30000, priceExcl: 27273, duration: { value: 3, unit: "month" } });
  savePlan(ctx, owner, plan);
  const form: FormMapping = {
    id: "form-3m",
    productId: product.id,
    planId: plan.id,
    name: "受講者登録（3か月）",
    responseSpreadsheetId: "sheet",
    responseSheetName: "3か月",
    mapping: { q1: "customer.name", q2: "customer.email", q3: "customer.phone", q4: "customer.custom.purpose", q5: "delivery.fields.level" },
    matchBy: ["email", "phone"],
    actions: { advanceStage: true, createDelivery: true, notify: true },
    active: true,
  };
  saveForm(ctx, owner, form);
  const mk = (email: string, role: User["role"], productIds = [product.id], capacity: number | null = null) =>
    saveUser(ctx, owner, { email, name: email.split("@")[0]!, role, productIds, active: true, capacity });
  const sales1 = mk("sales1@example.com", "sales");
  const sales2 = mk("sales2@example.com", "sales");
  const consult1 = mk("consult1@example.com", "delivery", [product.id], 10);
  const consult2 = mk("consult2@example.com", "delivery", [product.id], 10);
  const accounting = mk("acc@example.com", "accounting", []);
  const manager = mk("mgr@example.com", "manager");
  const viewer = mk("viewer@example.com", "viewer");
  return { ctx, clock, notifier, store, owner, product, plan, form, sales1, sales2, consult1, consult2, accounting, manager, viewer };
}
