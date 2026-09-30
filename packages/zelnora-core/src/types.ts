// Zelnora app の論理モデル（エンティティ）。どの商材にも共通の概念で表す（要件定義書 2.1）。
// 日付は "YYYY-MM-DD"（日本時間）、日時は ISO 8601（UTC）で保存する。

export type Role = "owner" | "admin" | "manager" | "sales" | "delivery" | "accounting" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "オーナー",
  admin: "管理者",
  manager: "マネージャー",
  sales: "営業担当",
  delivery: "提供担当",
  accounting: "経理",
  viewer: "閲覧者",
};

export interface User {
  id: string; // メールアドレス（小文字）
  email: string;
  name: string;
  role: Role;
  productIds: string[]; // 担当商材（owner/admin/accounting は全商材）
  active: boolean;
  capacity?: number | null; // 提供担当の上限人数
  createdAt: string;
}

/** 段階の種類：自動処理はこの種類に結び付ける（2.3） */
export type StageKind = "new" | "contact" | "meeting" | "contract" | "won" | "registered" | "lost" | "hold";

export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  new: "新規",
  contact: "接触",
  meeting: "面談",
  contract: "契約手続き",
  won: "成約",
  registered: "登録完了",
  lost: "失注",
  hold: "保留",
};

export type FieldType = "text" | "number" | "date" | "datetime" | "select" | "textarea";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  hiddenFromRoles?: Role[];
}

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  order: number;
  /** 移動時に必須の項目（商談のフィールドキー） */
  requiredFields: string[];
  /** 次のアクションの初期値 */
  defaultNextAction?: { title: string; days: number; fromField?: string } | null;
  /** 滞在日数の基準（超えたら警告） */
  staleDays?: number | null;
  /** 確度（%）：売上の見込みに使う */
  probability?: number;
}

export type Recurrence = "none" | "weekly" | "biweekly" | "monthly";

export interface ProgressTemplateItem {
  id: string;
  name: string;
  /** 起点：開始日／前の項目の完了（または予定）日／終了日 */
  anchor: "start" | "previous" | "end";
  offsetDays: number;
  /** 繰り返し（終了日まで） */
  repeat: Recurrence;
  /** 完了に必要な記録 */
  completion: "check" | "session" | "date";
  /** 繰り返し時の名前（{n} に回数） */
  repeatName?: string;
  /** 繰り返しの回数の数え始め（例：2週目から数えるなら 2） */
  repeatStartNumber?: number;
}

export interface ProgressTemplate {
  id: string;
  name: string;
  items: ProgressTemplateItem[];
}

export type RevenueRule = "lump" | "prorate" | "installment" | "monthly";
export const REVENUE_RULE_LABELS: Record<RevenueRule, string> = {
  lump: "一括",
  prorate: "期間按分",
  installment: "分割払い",
  monthly: "月額",
};
export type RevenueBasis = "contract" | "payment" | "delivery_start";

export interface Product {
  id: string;
  name: string;
  templateType: string;
  status: "active" | "stopped";
  /** 呼び名の辞書（2.2） */
  dictionary: Record<string, string>;
  stages: Stage[];
  progressTemplates: ProgressTemplate[];
  customFields: { customer: FieldDef[]; deal: FieldDef[]; delivery: FieldDef[] };
  revenueRule: RevenueRule;
  revenueBasis: RevenueBasis;
  /** 提供の開始日：登録日か初回の予定日か */
  deliveryStartBasis: "registration" | "first_session";
  defaultSalesOwner?: string | null;
  defaultDeliveryOwner?: string | null;
  salesAssignment: "manual" | "round_robin" | "default";
  deliveryAssignment: "manual" | "least_loaded" | "default";
  /** 活動記録のよく使う文面 */
  activityTemplates: { title: string; body: string }[];
  /** 失注理由の選択肢 */
  lostReasons: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PriceRevision {
  effectiveFrom: string; // YYYY-MM-DD
  priceExcl: number;
  priceIncl: number;
}

export interface Plan {
  id: string;
  productId: string;
  name: string;
  description: string;
  /** 税抜・税込のどちらを基準に入力するか */
  priceBasis: "excl" | "incl";
  priceExcl: number;
  priceIncl: number;
  taxRate: number; // 例 0.1
  rounding: "floor" | "round";
  duration: { value: number; unit: "day" | "week" | "month" };
  payment: { type: "lump" | "installment"; count: number; intervalMonths: number };
  revenueRule?: RevenueRule | null; // 未指定なら商材の既定
  progressTemplateId?: string | null;
  formId?: string | null;
  status: "active" | "stopped";
  priceHistory: PriceRevision[];
  createdAt: string;
  updatedAt: string;
}

export type CustomerStatus = "lead" | "customer" | "dormant" | "excluded";
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  lead: "リード",
  customer: "顧客",
  dormant: "休眠",
  excluded: "対象外",
};

export interface Customer {
  id: string;
  name: string;
  kana: string;
  email: string;
  phone: string;
  company: string;
  source: string; // 流入経路
  status: CustomerStatus;
  tags: string[];
  salesOwner: string | null;
  note: string;
  custom: Record<string, string>;
  mergedInto?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface NextAction {
  title: string;
  due: string; // YYYY-MM-DD
}

export interface Deal {
  id: string;
  customerId: string;
  productId: string;
  planId: string | null;
  stageId: string;
  owner: string | null;
  amount: number | null; // 見込み金額（税込）
  paymentMethod: string | null;
  fields: Record<string, string>; // 面談日時、失注理由などの項目（requiredFields の対象）
  nextAction: NextAction | null;
  stageEnteredAt: string;
  /** 段階の履歴（ファネル分析用） */
  history: { stageId: string; at: string; by: string }[];
  status: "open" | "won" | "lost";
  source: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Contract {
  id: string;
  dealId: string;
  customerId: string;
  productId: string;
  planId: string;
  amountIncl: number;
  paymentMethod: string;
  signedAt: string; // YYYY-MM-DD
  status: "signed" | "canceled";
  externalId?: string | null; // 外部の契約システムの契約ID
  createdAt: string;
}

export interface Registration {
  id: string;
  customerId: string | null;
  productId: string;
  planId: string;
  formId: string;
  responseId: string;
  answers: Record<string, string>; // 質問ID → 回答
  questions: Record<string, string>; // 質問ID → 質問文（表示用の控え）
  status: "ok" | "pending_merge" | "pending_no_deal" | "pending_before_contract" | "failed";
  message: string;
  receivedAt: string;
  createdAt: string;
}

export type DeliveryStatus = "active" | "paused" | "completed" | "canceled" | "plan_changed";

export interface Delivery {
  id: string;
  customerId: string;
  productId: string;
  planId: string;
  dealId: string | null;
  owner: string | null;
  startDate: string;
  endDate: string;
  status: DeliveryStatus;
  nextAction: NextAction | null;
  pauses: { from: string; to: string; reason: string }[];
  endReason: string;
  endedAt: string | null;
  satisfaction?: { score: number; comment: string } | null;
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProgressItem {
  id: string;
  deliveryId: string;
  templateItemId: string;
  name: string;
  seq: number;
  dueDate: string;
  doneAt: string | null;
  status: "planned" | "done" | "canceled";
  completion: "check" | "session" | "date";
  record: { attendance?: "attended" | "absent" | "rescheduled"; content?: string; homework?: string } | null;
}

export type ActivityType =
  | "call"
  | "meeting"
  | "message"
  | "memo"
  | "stage"
  | "contract"
  | "registration"
  | "progress"
  | "revenue"
  | "form"
  | "system";

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: "電話",
  meeting: "面談",
  message: "メッセージ",
  memo: "メモ",
  stage: "段階の変化",
  contract: "契約",
  registration: "登録",
  progress: "進捗",
  revenue: "売上",
  form: "フォーム回答",
  system: "システム",
};

export interface Activity {
  id: string;
  customerId: string;
  dealId: string | null;
  deliveryId: string | null;
  type: ActivityType;
  result: string;
  durationMin: number | null;
  note: string;
  at: string;
  by: string;
}

export type RevenueStatus = "planned" | "confirmed" | "canceled" | "refunded";

export interface Revenue {
  id: string;
  customerId: string;
  productId: string;
  planId: string;
  dealId: string | null;
  contractId: string | null;
  owner: string | null; // 担当営業
  kind: "sale" | "refund" | "discount" | "adjustment";
  amountExcl: number;
  tax: number;
  amountIncl: number;
  month: string; // 計上月 YYYY-MM
  status: RevenueStatus;
  paymentMethod: string;
  dueDate: string | null; // 入金予定日
  paidAt: string | null;
  paidAmount: number | null;
  installmentNo: number | null;
  parentId: string | null; // 返金・値引きの元の売上
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Closing {
  id: string; // YYYY-MM
  month: string;
  closedAt: string;
  closedBy: string;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string;
  status: "closed" | "open";
}

export interface Target {
  id: string; // `${user}:${month}`
  user: string;
  month: string;
  count: number;
  amount: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string; // JSON
}

export interface ImportLog {
  id: string;
  at: string;
  formId: string;
  responseId: string;
  result: "ok" | "pending" | "failed";
  message: string;
  attempts: number;
  payload: string; // 再試行用のJSON
}

export interface FormMapping {
  id: string; // フォームID
  productId: string;
  planId: string;
  name: string;
  responseSpreadsheetId: string;
  responseSheetName: string;
  /** 質問ID → 項目（customer.name / customer.email / customer.custom.xxx / delivery.fields.xxx ...） */
  mapping: Record<string, string>;
  /** 同じ人の判定に使う項目 */
  matchBy: ("email" | "phone")[];
  /** 取り込み後の処理 */
  actions: { advanceStage: boolean; createDelivery: boolean; notify: boolean };
  prefillQuestions?: { name?: string; email?: string };
  publishedUrl?: string;
  active: boolean;
}

export type EntityName =
  | "users"
  | "customers"
  | "deals"
  | "contracts"
  | "registrations"
  | "deliveries"
  | "progress"
  | "activities"
  | "revenues"
  | "closings"
  | "targets"
  | "audit"
  | "imports"
  | "savedViews"
  | "settingsVersions";

export interface DataSource {
  id: string;
  name: string;
  spreadsheetId: string;
  entity: EntityName | "summary" | "registry";
  sheetName: string;
  headerRow: number;
  /** 項目キー → 見出し */
  columns: Record<string, string>;
  status: "ok" | "check" | "stopped";
  lastCheckedAt: string | null;
  message: string;
}

export interface SavedView {
  id: string;
  name: string;
  owner: string;
  shared: boolean;
  screen: "customers" | "deals";
  filter: string; // JSON
  columns: string[];
}

/** 設定一式（版管理の対象） */
export interface Settings {
  version: number;
  organizationName: string;
  products: Product[];
  plans: Plan[];
  forms: FormMapping[];
  dataSources: DataSource[];
  allowedDomains: string[];
  notifications: { slackWebhook: string; googleChatWebhook: string; email: boolean };
  maskedFields: { field: "email" | "phone"; roles: Role[] }[];
  wizardDrafts: Record<string, unknown>;
  updatedAt: string;
  updatedBy: string;
}

export interface SettingsVersion {
  id: string;
  version: number;
  at: string;
  by: string;
  comment: string;
  snapshot: string; // JSON
}
