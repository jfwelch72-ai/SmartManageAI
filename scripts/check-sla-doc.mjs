#!/usr/bin/env node
// Thin wrapper around `scripts/generate-sla-doc.ts --check`. Wired into
// `scripts/ci.sh` so the build fails if `docs/sla.md` drifts from the
// canonical SLA tier table in `shared/sla/policy.ts`.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "generate-sla-doc.ts");

const result = spawnSync("npx", ["tsx", SCRIPT, "--check"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
