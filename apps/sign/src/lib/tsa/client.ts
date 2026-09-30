// RFC 3161 タイムスタンプのクライアント
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { randomBytes } from "node:crypto";

export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

export interface TimestampResult {
  /** DERエンコードしたTimeStampToken（ContentInfo）のbase64 */
  token: string;
  genTime: Date;
  serial: string;
  tsaUrl: string;
}

export class TsaError extends Error {}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function hex(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("hex");
}

/** OCTET STRING の中身（構造化形式で分割されている場合は連結する） */
function octets(os: asn1js.OctetString): Uint8Array {
  if (os.idBlock.isConstructed) {
    const parts = (os.valueBlock.value as asn1js.OctetString[]).map((p) => octets(p));
    return new Uint8Array(Buffer.concat(parts));
  }
  return os.valueBlock.valueHexView;
}

export function buildTimeStampRequest(sha256Hex: string, nonce: Uint8Array): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new TsaError("invalid sha256");
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID_SHA256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(Buffer.from(sha256Hex, "hex")) }),
    }),
    nonce: new asn1js.Integer({ valueHex: toArrayBuffer(nonce) }),
    certReq: true,
  });
  return new Uint8Array(req.toSchema().toBER(false));
}

/** TimeStampResp を解析し、要求したハッシュとnonceに対する正当なトークンか確かめる */
export async function parseTimeStampResponse(
  der: Uint8Array,
  sha256Hex: string,
  nonce?: Uint8Array,
): Promise<{ tokenDer: Uint8Array; genTime: Date; serial: string }> {
  const asn = asn1js.fromBER(toArrayBuffer(der));
  if (asn.offset === -1) throw new TsaError("TSAの応答を解析できません");
  const resp = new pkijs.TimeStampResp({ schema: asn.result });
  const status = resp.status.status;
  if (status !== 0 && status !== 1) {
    throw new TsaError(`TSAが要求を拒否しました（status=${status}）`);
  }
  if (!resp.timeStampToken) throw new TsaError("TSAの応答にトークンがありません");
  const signed = new pkijs.SignedData({ schema: resp.timeStampToken.content });
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new TsaError("TSTInfoがありません");
  const tstInfo = pkijs.TSTInfo.fromBER(toArrayBuffer(octets(eContent)));
  const imprint = hex(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (imprint !== sha256Hex) throw new TsaError("タイムスタンプのハッシュ値が要求と一致しません");
  if (tstInfo.messageImprint.hashAlgorithm.algorithmId !== OID_SHA256) throw new TsaError("ハッシュアルゴリズムが一致しません");
  if (nonce) {
    const got = tstInfo.nonce ? hex(tstInfo.nonce.valueBlock.valueHexView).replace(/^0+/, "") : "";
    if (got !== hex(nonce).replace(/^0+/, "")) throw new TsaError("nonceが一致しません");
  }
  // 署名の検証（トークンに含まれる証明書で。信頼チェーンの検証は検証者側で行う）
  // pkijsはTSTInfoの場合に元データを要求するため（ハッシュ照合は上で実施済み）、
  // 複製したSignedDataのコンテンツ種別を id-data として署名値だけを検証する。
  const forVerify = new pkijs.SignedData({ schema: resp.timeStampToken.content });
  forVerify.encapContentInfo.eContentType = "1.2.840.113549.1.7.1";
  const ok = await forVerify.verify({ signer: 0, checkChain: false }).catch((e: unknown) => {
    throw new TsaError(`タイムスタンプの署名を検証できません: ${String(e)}`);
  });
  if (!ok) throw new TsaError("タイムスタンプの署名が不正です");
  return {
    tokenDer: new Uint8Array(resp.timeStampToken.toSchema().toBER(false)),
    genTime: tstInfo.genTime,
    serial: tstInfo.serialNumber.valueBlock.valueDec
      ? String(tstInfo.serialNumber.valueBlock.valueDec)
      : hex(tstInfo.serialNumber.valueBlock.valueHexView),
  };
}

export interface TsaOptions {
  url: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** SHA-256ハッシュ値に対するタイムスタンプを取得する */
export async function requestTimestamp(sha256Hex: string, opts: TsaOptions): Promise<TimestampResult> {
  const nonce = randomBytes(8);
  nonce[0] = nonce[0]! & 0x7f; // 正の整数にする
  const body = buildTimeStampRequest(sha256Hex, nonce);
  const headers: Record<string, string> = { "Content-Type": "application/timestamp-query" };
  if (opts.username) {
    headers.Authorization = `Basic ${Buffer.from(`${opts.username}:${opts.password ?? ""}`).toString("base64")}`;
  }
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(opts.url, {
      method: "POST",
      headers,
      body: Buffer.from(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch (e) {
    throw new TsaError(`TSAに接続できません: ${String(e)}`);
  }
  if (!res.ok) throw new TsaError(`TSAがエラーを返しました（HTTP ${res.status}）`);
  const der = new Uint8Array(await res.arrayBuffer());
  const parsed = await parseTimeStampResponse(der, sha256Hex, nonce);
  return {
    token: Buffer.from(parsed.tokenDer).toString("base64"),
    genTime: parsed.genTime,
    serial: parsed.serial,
    tsaUrl: opts.url,
  };
}
