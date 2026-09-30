import type { Metadata, Viewport } from "next";
import "./globals.css";

// CSPのnonceをリクエストごとに付与するため、すべてのページを動的に描画する
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "電子契約", template: "%s | 電子契約" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
