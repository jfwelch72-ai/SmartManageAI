import { spawnSync } from "node:child_process";

export default async function globalSetup() {
  if (process.env.SKIP_TEST_DB_PUSH === "1") {
    console.log("[vitest globalSetup] SKIP_TEST_DB_PUSH=1 set, skipping drizzle-kit push.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. The test database must be provisioned before running vitest, " +
        "or set SKIP_TEST_DB_PUSH=1 to bypass schema sync entirely.",
    );
  }

  console.log("[vitest globalSetup] Syncing test database schema via `drizzle-kit push --force`...");
  const result = spawnSync(
    "npx",
    ["drizzle-kit", "push", "--force"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `drizzle-kit push failed with exit code ${result.status}. ` +
        `Test database schema is out of sync with shared/schema. ` +
        `Set SKIP_TEST_DB_PUSH=1 to bypass this check (not recommended).`,
    );
  }

  console.log("[vitest globalSetup] Test database schema is in sync.");
}
