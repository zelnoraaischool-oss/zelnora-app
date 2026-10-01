// 電子契約システムの代わり（デモモードとテスト用）。本物と同じ約束（externalRef で二重に作らない等）で動く
import type { EsignCreateRequest, EsignGateway, EsignRemoteStatus, EsignTemplateInfo } from "./context";

interface MemoryContract extends EsignRemoteStatus {
  request: EsignCreateRequest;
  createdAt: string;
}

export class MemoryEsignGateway implements EsignGateway {
  readonly contracts: MemoryContract[] = [];
  private seq = 0;

  constructor(
    private readonly tpls: EsignTemplateInfo[],
    private readonly baseUrl = "https://sign.example",
  ) {}

  templates(): EsignTemplateInfo[] {
    return this.tpls;
  }

  create(req: EsignCreateRequest) {
    const t = this.tpls.find((x) => x.id === req.templateId);
    if (!t) throw new Error("テンプレートが見つかりません");
    for (const v of t.variables) {
      if (v.filledBy === "admin" && v.required && !req.values[v.key]) throw new Error(`「${v.key}」を入力してください`);
    }
    const existing = this.contracts.find((c) => c.externalRef === req.externalRef && ["sent", "viewed", "signed"].includes(c.status));
    if (existing) return { ...this.view(existing), created: false };
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
    const c: MemoryContract = {
      contractId: id,
      externalRef: req.externalRef,
      title: req.title ?? t.name,
      status: "sent",
      signedAt: null,
      sha256: null,
      url: `${this.baseUrl}/s#demo-${this.seq}`,
      adminUrl: `${this.baseUrl}/admin/contracts/${id}`,
      request: req,
      createdAt: new Date().toISOString(),
    };
    this.contracts.push(c);
    return { ...this.view(c), created: true, emailSent: req.sendEmail && !!req.signer.email };
  }

  status(q: { contractId?: string; externalRef?: string }): EsignRemoteStatus {
    const c = q.contractId ? this.contracts.find((x) => x.contractId === q.contractId) : [...this.contracts].reverse().find((x) => x.externalRef === q.externalRef);
    if (!c) throw new Error("契約が見つかりません");
    return this.view(c);
  }

  /** 署名の完了（デモ・テスト用） */
  sign(contractId: string, at = new Date().toISOString()): EsignRemoteStatus {
    const c = this.contracts.find((x) => x.contractId === contractId);
    if (!c) throw new Error("契約が見つかりません");
    if (c.status !== "signed") {
      c.status = "signed";
      c.signedAt = at;
      c.sha256 = Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(i * 7 + this.seq) % 16]).join("");
    }
    return this.view(c);
  }

  cancel(contractId: string): EsignRemoteStatus {
    const c = this.contracts.find((x) => x.contractId === contractId);
    if (!c) throw new Error("契約が見つかりません");
    if (c.status !== "signed") c.status = "canceled";
    return this.view(c);
  }

  private view(c: MemoryContract): EsignRemoteStatus {
    return {
      contractId: c.contractId,
      externalRef: c.externalRef,
      title: c.title,
      status: c.status,
      signedAt: c.signedAt,
      sha256: c.sha256 ?? null,
      url: c.status === "sent" || c.status === "viewed" ? c.url ?? null : null,
      adminUrl: c.adminUrl ?? null,
    };
  }

  /** 保存用（デモで localStorage に残す） */
  snapshot(): { seq: number; contracts: MemoryContract[] } {
    return { seq: this.seq, contracts: this.contracts };
  }

  restore(s: { seq: number; contracts: MemoryContract[] } | null | undefined): void {
    if (!s) return;
    this.seq = s.seq;
    this.contracts.splice(0, this.contracts.length, ...s.contracts);
  }
}
