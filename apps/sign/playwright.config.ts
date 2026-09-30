import { defineConfig, devices } from "@playwright/test";

// 事前に ./scripts/dev-db.sh sign_e2e でDBを作り、bootstrap-owner と seed を実行しておく（README参照）
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/sign_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3100",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      APP_URL: "http://localhost:3100",
      AUTH_DRIVER: "dev",
      STORAGE_DRIVER: "local",
      TSA_URL: "dev",
      LOCAL_DATA_DIR: ".data-e2e",
    },
  },
});
