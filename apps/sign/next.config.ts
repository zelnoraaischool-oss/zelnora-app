import path from "node:path";
import type { NextConfig } from "next";

// モノレポのルート（Vercel でも pnpm のワークスペース全体を見てファイルを集める）
const repoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // PDF生成に使う日本語フォント（assets/fonts）をサーバー関数に同梱する
  outputFileTracingIncludes: {
    "/api/**": ["./assets/fonts/*.ttf"],
    "/admin/**": ["./assets/fonts/*.ttf"],
  },
  // 既存の契約書（PDF）の格納で、4MBまでのファイルを受け付ける
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  serverExternalPackages: ["pg", "subset-font", "harfbuzzjs"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
