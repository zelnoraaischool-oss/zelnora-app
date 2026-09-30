// 開発・テスト用の簡易タイムスタンプ局（RFC 3161）。本番では絶対に使わないこと。
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { randomBytes, webcrypto } from "node:crypto";

interface DevTsa {
  keys: CryptoKeyPair;
  cert: pkijs.Certificate;
}

let instance: Promise<DevTsa> | null = null;

function ab(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

async function createDevTsa(): Promise<DevTsa> {
  const crypto = webcrypto as unknown as Crypto;
  const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const keys = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ valueHex: ab(randomBytes(8)) });
  const name = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Development TSA (NOT FOR PRODUCTION)" }) })];
  cert.issuer.typesAndValues = name;
  cert.subject.typesAndValues = name;
  cert.notBefore.value = new Date(Date.now() - 60_000);
  cert.notAfter.value = new Date(Date.now() + 365 * 24 * 3600_000);
  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.37",
      critical: true,
      extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }).toSchema().toBER(false),
      parsedValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }),
    }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return { keys, cert };
}

/** TimeStampReq(DER) を受け取り TimeStampResp(DER) を返す */
export async function devTsaRespond(reqDer: Uint8Array, now: Date = new Date()): Promise<Uint8Array> {
  if (!instance) instance = createDevTsa();
  const { keys, cert } = await instance;
  const req = pkijs.TimeStampReq.fromBER(ab(reqDer));
  const tst = new pkijs.TSTInfo({
    version: 1,
    policy: "1.3.6.1.4.1.99999.1",
    messageImprint: req.messageImprint,
    serialNumber: new asn1js.Integer({ valueHex: ab(randomBytes(8)) }),
    genTime: now,
    nonce: req.nonce,
    ordering: false,
  });
  const encap = new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4" });
  // 実際のTSAと同じく、分割しないOCTET STRINGにする（pkijsは既定で構造化形式に変換するため後から設定）
  encap.eContent = new asn1js.OctetString({ valueHex: tst.toSchema().toBER(false) });
  const signed = new pkijs.SignedData({
    version: 3,
    encapContentInfo: encap,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      }),
    ],
    certificates: req.certReq ? [cert] : undefined,
  });
  await signed.sign(keys.privateKey, 0, "SHA-256");
  const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
  const resp = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
    timeStampToken: token,
  });
  return new Uint8Array(resp.toSchema().toBER(false));
}
