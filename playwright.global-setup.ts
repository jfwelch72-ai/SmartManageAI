import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Task #1890 — Self-heal Playwright's bundled WebKit on the Replit dev
// container.
//
// Background (see Task #1866 + `scripts/setup-playwright-webkit.sh`):
// Playwright ships a `MiniBrowser` shell wrapper inside the WebKit zip that
// hard-codes `LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib"`, clobbering
// the nix-store paths in `$REPLIT_LD_LIBRARY_PATH` where libjpeg.so.8 /
// libpsl.so.5 / libnghttp2.so.14 live. The setup script patches the wrapper
// to *append* those paths instead.
//
// The patch was previously re-applied only by `scripts/post-merge.sh` —
// which runs after Replit merges, but NOT after a plain `npm install`, and
// NOT after Playwright is bumped to a version whose `npx playwright install`
// lays down a fresh, unpatched MiniBrowser (e.g. webkit-2272 → webkit-2273).
//
// Running the patcher here means every `npx playwright test` invocation
// re-patches the current WebKit revision before any worker spawns a browser.
// The patcher exits silently (~50ms) when wrappers are already patched and
// — thanks to PLAYWRIGHT_WEBKIT_PATCH_ONLY=1 — refuses to download WebKit
// on the fly when it isn't installed (so chromium/firefox-only test runs
// don't pay any cost beyond a no-op shell exec).
//
// Outside the Replit dev container (no $REPLIT_LD_LIBRARY_PATH — i.e. CI
// on Ubuntu, where libs already live in /usr/lib/x86_64-linux-gnu) this
// hook is a no-op, so it can't regress upstream environments.
export default async function globalSetup(): Promise<void> {
  if (!process.env.REPLIT_LD_LIBRARY_PATH) return;

  const here = dirname(fileURLToPath(import.meta.url));
  const script = resolve(here, "scripts/setup-playwright-webkit.sh");
  if (!existsSync(script)) return;

  const result = spawnSync("bash", [script], {
    env: { ...process.env, PLAYWRIGHT_WEBKIT_PATCH_ONLY: "1" },
    stdio: "inherit",
    timeout: 60_000,
  });

  if (result.status !== 0) {
    // Don't block the run — chromium/firefox tests should still proceed
    // even if the WebKit patcher hiccupped. WebKit specs will surface a
    // launch error themselves if the patch is genuinely required and
    // failed.
    console.warn(
      `[playwright global-setup] setup-playwright-webkit.sh exited ${result.status ?? "with signal " + result.signal} — continuing without re-patch.`,
    );
  }
}
