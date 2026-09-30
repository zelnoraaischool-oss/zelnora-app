import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clientInfoFromHeaders } from "@/lib/server/auth";
import { deps } from "@/lib/server/deps";
import {
  downloadSignedPdf,
  finalizeSignature,
  getSignerDocument,
  markRead,
  openContract,
  previewPdf,
  requestOtp,
  SESSION_TTL_MS,
  saveSignerValues,
  verifyOtp,
} from "@/lib/server/signing";
import { AppError } from "@/lib/server/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const COOKIE = "sgn";

function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

/** 署名者用API。トークンはURLのフラグメントから取り出し、ヘッダーで受け取る（ログに残さないため） */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const token = req.headers.get("x-sign-token");
  const store = await cookies();
  const session = store.get(COOKIE)?.value;
  const client = clientInfoFromHeaders(req.headers);
  const d = deps();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (action) {
      case "open":
        return NextResponse.json(await openContract(d, token, session, client));
      case "otp-request":
        return NextResponse.json({ ok: true, ...(await requestOtp(d, token, typeof body.email === "string" ? body.email : null, client)) });
      case "otp-verify": {
        const r = await verifyOtp(d, token, String(body.code ?? ""), client);
        store.set(COOKIE, r.session, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/api/sign",
          maxAge: SESSION_TTL_MS / 1000,
        });
        return NextResponse.json({ ok: true });
      }
      case "document":
        return NextResponse.json({ ok: true, document: await getSignerDocument(d, token, session) });
      case "read":
        await markRead(d, token, session, client);
        return NextResponse.json({ ok: true });
      case "values": {
        const values = (body.values ?? {}) as Record<string, unknown>;
        const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")]));
        return NextResponse.json(await saveSignerValues(d, token, session, clean, client));
      }
      case "finalize": {
        const c = (body.consents ?? {}) as Record<string, unknown>;
        const r = await finalizeSignature(
          d,
          token,
          session,
          {
            consents: {
              content: c.content === true,
              privacy: c.privacy === true,
              keyClauses: (c.keyClauses ?? {}) as Record<string, boolean>,
            },
            signedName: String(body.signedName ?? ""),
            signatureImage: typeof body.signatureImage === "string" ? body.signatureImage : null,
          },
          client,
        );
        return NextResponse.json({ ok: true, sha256: r.sha256, signedAt: r.signedAt });
      }
      case "preview-pdf":
        return pdfResponse(await previewPdf(d, token, session, client), "確認用.pdf");
      case "final-pdf": {
        const r = await downloadSignedPdf(d, token, session, client);
        return pdfResponse(r.bytes, r.filename);
      }
      default:
        return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof AppError) {
      return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
    }
    console.error("[sign]", action, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, code: "server_error", error: "エラーが発生しました。時間をおいて再度お試しください。" }, { status: 500 });
  }
}
