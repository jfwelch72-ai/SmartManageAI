#!/usr/bin/env node
// Thin wrapper that runs the console→logger codemod in check-only mode.
// Intended for CI: exits non-zero if any sanctioned `console.*` slipped
// back into `server/`. See `scripts/codemod-console-to-logger.mjs` for the
// allow-list and the underlying scan.
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const target = path.join(here, "codemod-console-to-logger.mjs");
const r = spawnSync(process.execPath, [target, "--check"], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
