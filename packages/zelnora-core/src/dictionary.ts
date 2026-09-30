import type { Product } from "./types";

/** 画面の標準の呼び名（3章）。商材ごとの辞書で置き換える（2.2） */
export const DEFAULT_LABELS: Record<string, string> = {
  product: "商材",
  plan: "プラン",
  customer: "顧客",
  lead: "リード",
  deal: "商談",
  contract: "契約",
  registration: "登録",
  delivery: "提供",
  deliveryOwner: "提供担当",
  salesOwner: "営業担当",
  progressItem: "進捗項目",
  activity: "活動",
  revenue: "売上",
  nextAction: "次のアクション",
};

/** 呼び名を引く。商材を指定しなければ標準の呼び名 */
export function label(key: string, product?: Pick<Product, "dictionary"> | null): string {
  return product?.dictionary?.[key] || DEFAULT_LABELS[key] || key;
}

export function labels(product?: Pick<Product, "dictionary"> | null): Record<string, string> {
  return { ...DEFAULT_LABELS, ...(product?.dictionary ?? {}) };
}
