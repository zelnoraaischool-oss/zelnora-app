import { describe, expect, it } from "vitest";
import {
  applyEsignStatus,
  type Contract,
  createLead,
  type Deal,
  esignBlocker,
  guessEsignSource,
  handleApi,
  MemoryEsignGateway,
  moveStage,
  requestEsign,
  type Revenue,
  saveEsignSettings,
  syncEsignStatuses,
} from "../src";
import { setup } from "./helpers";

const TEMPLATE = {
  id: "tpl-1",
  name: "申込契約書",
  variables: [
    { key: "氏名", type: "text", filledBy: "admin" as const, required: true },
    { key: "料金", type: "money", filledBy: "admin" as const, required: true },
    { key: "プラン名", type: "text", filledBy: "admin" as const, required: true },
    { key: "契約日", type: "date", filledBy: "admin" as const, required: true },
    { key: "住所", type: "address", filledBy: "signer" as const, required: true },
  ],
};

function withEsign() {
  const env = setup();
  const gateway = new MemoryEsignGateway([TEMPLATE]);
  env.ctx.esign = gateway;
  const values = Object.fromEntries(TEMPLATE.variables.filter((v) => v.filledBy === "admin").map((v) => [v.key, guessEsignSource(v)]));
  saveEsignSettings(env.ctx, env.owner, {
    enabled: true,
    baseUrl: "https://sign.example.jp/",
    plans: { [env.plan.id]: { templateId: TEMPLATE.id, templateName: TEMPLATE.name, values } },
  });
  const { deal } = createLead(env.ctx, env.sales1, { customer: { name: "山田 太郎", email: "taro@example.com" }, productId: env.product.id });
  moveStage(env.ctx, env.sales1, deal.id, { stageId: "appo", fields: { contactMethod: "LINE" } });
  moveStage(env.ctx, env.sales1, deal.id, { stageId: "meeting", fields: { meetingAt: "2026-10-05" } });
  return { ...env, gateway, dealId: deal.id };
}

describe("電子契約との連携（12章）", () => {
  it("変数名から値の出どころを推測する", () => {
    expect(guessEsignSource({ key: "氏名", type: "text" })).toBe("customer.name");
    expect(guessEsignSource({ key: "料金", type: "money" })).toBe("deal.amount");
    expect(guessEsignSource({ key: "契約日", type: "date" })).toBe("today");
    expect(guessEsignSource({ key: "メールアドレス", type: "email" })).toBe("customer.email");
    expect(guessEsignSource({ key: "備考", type: "text" })).toBe("");
  });

  it("契約の段階に移すと契約書を作って送り、署名完了で成約・契約の記録に契約IDが残る", () => {
    const env = withEsign();
    const { ctx, sales1, plan, gateway, dealId, notifier } = env;
    const moved = moveStage(ctx, sales1, dealId, { stageId: "contract", planId: plan.id, paymentMethod: "銀行振込" });
    expect(moved.esignUrl).toMatch(/^https:\/\/sign\.example\/s#/);
    expect(moved.deal.esign).toMatchObject({ status: "sent", templateId: "tpl-1", requestedBy: "sales1@example.com" });
    const sent = gateway.contracts[0]!;
    expect(sent.externalRef).toBe(dealId);
    expect(sent.request.values).toEqual({ 氏名: "山田 太郎", 料金: "30000", プラン名: plan.name, 契約日: "2026-09-30" });
    expect(sent.request.signer).toMatchObject({ name: "山田 太郎", email: "taro@example.com" });
    expect(sent.request.sendEmail).toBe(true);

    // 同じ商談でもう一度送っても、契約書は1つ
    const again = requestEsign(ctx, sales1, dealId);
    expect(again.created).toBe(false);
    expect(gateway.contracts).toHaveLength(1);

    // 署名完了の通知 → 成約
    const signed = gateway.sign(sent.contractId, "2026-10-02T03:00:00.000Z");
    const r = applyEsignStatus(ctx, signed);
    expect(r).toMatchObject({ dealId, changed: true, won: true });
    const deal = ctx.store.get<Deal>("deals", dealId)!;
    expect(deal.status).toBe("won");
    expect(deal.stageId).toBe("won");
    expect(deal.esign).toMatchObject({ status: "signed", url: null, sha256: signed.sha256 });
    const contract = ctx.store.all<Contract>("contracts").find((c) => c.dealId === dealId)!;
    expect(contract.externalId).toBe(sent.contractId);
    expect(contract.signedAt).toBe("2026-10-02");
    expect(ctx.store.all<Revenue>("revenues").some((x) => x.dealId === dealId)).toBe(true);
    expect(notifier.sent.some((n) => n.kind === "deal.won")).toBe(true);

    // 同じ通知が何度届いても変わらない
    expect(applyEsignStatus(ctx, signed)).toMatchObject({ changed: false, won: false });
    expect(ctx.store.all<Contract>("contracts").filter((c) => c.dealId === dealId)).toHaveLength(1);
  });

  it("通知が届かなくても、定期確認で署名完了を反映する。取消は担当に知らせる", () => {
    const env = withEsign();
    const { ctx, sales1, plan, gateway, dealId, notifier } = env;
    moveStage(ctx, sales1, dealId, { stageId: "contract", planId: plan.id, paymentMethod: "銀行振込" });
    const c = gateway.contracts[0]!;
    expect(syncEsignStatuses(ctx)).toMatchObject({ checked: 1, changed: 0 });
    gateway.cancel(c.contractId);
    expect(syncEsignStatuses(ctx)).toMatchObject({ checked: 1, changed: 1 });
    expect(ctx.store.get<Deal>("deals", dealId)!.esign?.status).toBe("canceled");
    expect(notifier.sent.some((n) => n.kind === "esign.ended" && n.to.includes("sales1@example.com"))).toBe(true);

    // 作り直して、定期確認で署名完了 → 成約
    const re = requestEsign(ctx, sales1, dealId);
    expect(re.created).toBe(true);
    gateway.sign(re.deal.esign!.contractId);
    syncEsignStatuses(ctx);
    expect(ctx.store.get<Deal>("deals", dealId)!.status).toBe("won");
    // 古い契約書の取消が後から届いても、新しい契約書の状態は変えない
    applyEsignStatus(ctx, gateway.status({ contractId: c.contractId }));
    expect(ctx.store.get<Deal>("deals", dealId)!.esign?.status).toBe("signed");
  });

  it("作成に失敗しても段階の移動は止めず、記録して担当に知らせる。設定がなければ従来どおり", () => {
    const env = withEsign();
    const { ctx, sales1, plan, dealId, notifier } = env;
    ctx.esign = {
      templates: () => [],
      create: () => {
        throw new Error("接続できません");
      },
      status: () => {
        throw new Error("接続できません");
      },
    };
    const moved = moveStage(ctx, sales1, dealId, { stageId: "contract", planId: plan.id, paymentMethod: "銀行振込" });
    expect(moved.deal.stageId).toBe("contract");
    expect(moved.esignError).toMatch(/接続できません/);
    expect(notifier.sent.some((n) => n.kind === "esign.failed")).toBe(true);

    const plain = setup();
    const { deal } = createLead(plain.ctx, plain.sales1, { customer: { name: "B", email: "b@example.com" }, productId: plain.product.id });
    expect(esignBlocker(plain.ctx, deal)).toMatch(/無効/);
  });

  it("権限：連携の設定はオーナーだけ、送付は担当の商談だけ", () => {
    const env = withEsign();
    const { ctx, sales2, manager, dealId, plan, sales1 } = env;
    moveStage(ctx, sales1, dealId, { stageId: "contract", planId: plan.id, paymentMethod: "銀行振込" });
    expect(() => saveEsignSettings(ctx, manager, { enabled: false })).toThrow(/権限/);
    expect(() => requestEsign(ctx, sales2, dealId)).toThrow(/担当/);
    const res = handleApi(ctx, "sales2@example.com", { action: "deals.requestEsign", params: { id: dealId } });
    expect(res.ok).toBe(false);
    const ok = handleApi(ctx, "sales1@example.com", { action: "deals.refreshEsign", params: { id: dealId } });
    expect(ok.ok).toBe(true);
    const tpl = handleApi(ctx, "owner@example.com", { action: "esign.templates" });
    expect(tpl).toMatchObject({ ok: true, data: [{ id: "tpl-1" }] });
    expect(() => saveEsignSettings(ctx, env.owner, { enabled: true, baseUrl: "ftp://x" })).toThrow(/https/);
  });
});
