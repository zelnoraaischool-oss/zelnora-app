import "server-only";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../crypto";
import { audit, type ClientInfo } from "./audit";
import { upsertContact } from "./contacts";
import type { Deps } from "./deps";
import { stampDocument } from "./signing";
import { type Actor, AppError, type ContractRow } from "./types";

/** 格納できる既存の契約書の上限（Vercel のリクエスト本文の上限に合わせる） */
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;

export interface ImportContractInput {
  title: string;
  /** 相手方（会社名または氏名） */
  counterpartyName: string;
  signerName?: string | null;
  signerEmail?: string | null;
  /** 締結日 YYYY-MM-DD */
  signedDate: string;
  amount?: string | null;
  transactionDate?: string | null;
  note?: string | null;
  externalRef?: string | null;
  filename: string;
  bytes: Uint8Array;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * 既存の契約書（紙をスキャンしたもの・他のサービスで締結したもの）を格納する。
 * 原本のPDFは変更・削除できない状態で保存し、ハッシュにタイムスタンプを付ける（格納した時点で存在したことの証明）。
 * 格納した契約は検索・閲覧・検証ページでの照合の対象になる。
 */
export async function importExistingContract(d: Deps, actor: Actor, input: ImportContractInput, client?: ClientInfo) {
  const title = input.title.normalize("NFKC").trim();
  const counterparty = input.counterpartyName.normalize("NFKC").trim();
  if (!title) throw new AppError("契約書の名前を入力してください");
  if (!counterparty) throw new AppError("相手方を入力してください");
  if (!validDate(input.signedDate)) throw new AppError("締結日を正しく入力してください");
  if (input.signedDate > new Date(d.now().getTime() + 9 * 3600_000).toISOString().slice(0, 10)) {
    throw new AppError("締結日に未来の日付は指定できません");
  }
  if (input.transactionDate && !validDate(input.transactionDate)) throw new AppError("取引日を正しく入力してください");
  const amount = input.amount ? input.amount.normalize("NFKC").replace(/[,，円\s]/g, "") : "";
  if (amount && !/^\d{1,13}$/.test(amount)) throw new AppError("金額は数字で入力してください");
  if (!input.bytes.length) throw new AppError("ファイルを選んでください");
  if (input.bytes.length > IMPORT_MAX_BYTES) throw new AppError(`ファイルが大きすぎます（${IMPORT_MAX_BYTES / 1024 / 1024}MBまで）`);
  if (Buffer.from(input.bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new AppError("PDFのファイルを選んでください（Wordの場合はPDFに書き出してから格納してください）");
  }

  const sha256 = sha256Hex(input.bytes);
  const dup = await d.db.one<{ contract_id: string; title: string }>(
    "select d.contract_id, c.title from public.documents d join public.contracts c on c.id = d.contract_id where d.sha256 = $1",
    [sha256],
  );
  if (dup) throw new AppError(`この契約書はすでに格納されています（${dup.title}）`, "duplicate", 409);

  const contractId = randomUUID();
  const storagePath = `imported/${contractId}/${sha256}.pdf`;
  await d.storage.create(storagePath, input.bytes, "application/pdf");
  // 締結日は日本時間の0時として記録する
  const signedAt = new Date(`${input.signedDate}T00:00:00+09:00`).toISOString();
  const filename = input.filename.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "contract.pdf";

  const documentId = await d.db.tx(async (tx) => {
    await tx.query(
      `insert into public.contracts (id, source, title, status, amount, transaction_date, counterparty_name, expires_at,
         created_by, external_ref, note)
       values ($1, 'imported', $2, 'draft', $3, $4, $5, $6, $7, $8, $9)`,
      [
        contractId,
        title,
        amount || null,
        input.transactionDate || input.signedDate,
        counterparty,
        signedAt,
        actor.id,
        input.externalRef?.trim() || null,
        input.note?.trim() || null,
      ],
    );
    const signerName = input.signerName?.normalize("NFKC").trim();
    if (signerName) {
      const contact = await upsertContact(tx, actor, { name: signerName, email: input.signerEmail, company: counterparty !== signerName ? counterparty : null }, client);
      await tx.query(
        `insert into public.contract_parties (contract_id, contact_id, status, name, email, company, signed_name, signed_at)
         values ($1, $2, 'signed', $3, $4, $5, $3, $6)`,
        [contractId, contact.id, contact.name, contact.email, contact.company, signedAt],
      );
    }
    const doc = await tx.one<{ id: string }>(
      `insert into public.documents (contract_id, kind, storage_path, sha256, size_bytes, filename)
       values ($1, 'original', $2, $3, $4, $5) returning id`,
      [contractId, storagePath, sha256, input.bytes.length, filename],
    );
    await tx.query("insert into public.timestamp_jobs (document_id) values ($1)", [doc!.id]);
    await audit(tx, {
      contractId,
      actorType: "admin",
      actorId: actor.id,
      eventType: "contract.imported",
      payload: { title, counterparty, signed_date: input.signedDate, amount: amount || null, filename },
      client,
    });
    await audit(tx, {
      contractId,
      actorType: "admin",
      actorId: actor.id,
      eventType: "document.stored",
      payload: { document_id: doc!.id, sha256, size_bytes: input.bytes.length },
      client,
    });
    // 最後に締結済みにする（以降は変更不可）
    await tx.query("update public.contracts set status = 'signed', signed_at = $2 where id = $1", [contractId, signedAt]);
    return doc!.id;
  }).catch((e: unknown) => {
    if (e instanceof Error && /documents_sha256_key/.test(e.message)) {
      throw new AppError("この契約書はすでに格納されています", "duplicate", 409);
    }
    throw e;
  });

  const timestamped = await stampDocument(d, { id: documentId, contract_id: contractId, sha256 });
  const contract = await d.db.one<ContractRow>("select * from public.contracts where id = $1", [contractId]);
  return { contract: contract!, sha256, timestamped };
}
