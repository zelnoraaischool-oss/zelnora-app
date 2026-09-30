import "server-only";

/** 必須の環境変数を取得する。未設定なら起動時ではなく利用時に明確なエラーにする。 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません（.env.example を参照）`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

export function appUrl(): string {
  return (optionalEnv("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
}

export const isProduction = process.env.NODE_ENV === "production";
