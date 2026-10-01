import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PDF生成に使う日本語フォントをサーバー関数に同梱する
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@expo-google-fonts/noto-sans-jp/400Regular/*.ttf", "./node_modules/@expo-google-fonts/noto-sans-jp/700Bold/*.ttf"],
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
