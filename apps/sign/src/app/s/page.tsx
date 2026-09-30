import type { Metadata } from "next";
import { SignerApp } from "./signer-app";

export const metadata: Metadata = {
  title: "契約書のご確認",
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function SignPage() {
  return <SignerApp />;
}
