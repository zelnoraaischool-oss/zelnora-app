"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { Button, Input } from "./ui";

export function UrlShare({ url, copied: initiallyCopied = false }: { url: string; copied?: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(initiallyCopied);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [url]);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-2">
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="署名URL" />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={async () => {
              setCopied(await copyText(url));
            }}
          >
            {copied ? "✓ コピーしました" : "URLをコピー"}
          </Button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <Button type="button" variant="secondary" onClick={() => navigator.share({ url }).catch(() => {})}>
              共有…
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">DMや他のSNSで送る場合は、このURLを貼り付けてください。</p>
      </div>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="署名URLのQRコード" className="h-40 w-40 self-center rounded-lg ring-1 ring-slate-200" />
      )}
    </div>
  );
}
