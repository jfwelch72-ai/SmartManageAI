import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function resolveChromium(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  try {
    const found = execSync("command -v chromium || command -v chromium-browser || command -v google-chrome", {
      encoding: "utf8",
    }).trim();
    if (found) return found;
  } catch {}
  return undefined;
}

const CHROMIUM_PATH = resolveChromium();

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      ENABLE_DEV_SEED: "true",
      PORT,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
