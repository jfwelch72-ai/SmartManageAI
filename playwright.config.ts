import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "5000";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Task #1866 — In the Replit dev container, Playwright's bundled WebKit
// links against `libjpeg.so.8`, `libpsl.so.5`, and `libnghttp2.so.14`,
// which live under `$REPLIT_LD_LIBRARY_PATH` (see `replit.nix` for the
// `libjpeg8`, `libpsl`, and `nghttp2` deps). The `MiniBrowser` shell
// wrapper that ships in the playwright-webkit zip is patched by
// `scripts/setup-playwright-webkit.sh` so it appends those nix-store
// paths at launch — but Playwright's pre-launch host-requirements
// validator (`validateDependenciesLinux`) inspects the binary with
// `ldd` *before* the wrapper runs and bails with a "Host system is
// missing dependencies" error. Skipping that validator on Replit is
// safe because the patched wrapper resolves every required lib at
// runtime; on CI (Ubuntu) the libs are already in the standard
// `/usr/lib/x86_64-linux-gnu` paths so the validator passes regardless.
if (!process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS && process.env.REPLIT_LD_LIBRARY_PATH) {
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
}

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
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use a system-installed chromium when present (Replit / minimal CI
        // images may not ship Playwright's bundled Chromium). Other engines
        // always use Playwright's bundled binary.
        launchOptions: CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
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
      EMAIL_TRANSPORT: "noop",
      PORT,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
